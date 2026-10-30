// MCP authorization (OAuth 2.1 + PKCE, RFC 9728 resource metadata, RFC 8414 server metadata,
// RFC 7591 dynamic client registration) without a database: client ids are signed, request
// tickets and codes are sealed with keys derived from RELAY_SECRET, and the access token handed out
// is an ordinary Tabpass agent token (`tp_…`) that the person approved in the extension.
//
// So every MCP client can be given ONE address, e.g. https://tabs.migma.ai/mcp: on first use it is
// sent to /authorize, which asks the Tabpass extension in that browser, and the person approves in
// Tabpass's own window.

import { renderAuthorizePage, renderErrorPage } from './authorize-page.js';
import { base64url, randomToken, sha256, type Sealer } from './crypto.js';
import type { BrowserDirectory } from './directory.js';
import type { AgentAccess } from './protocol.js';
import { parseAgentToken } from './tokens.js';

export interface OAuthOptions {
  publicUrl: string;
  sealer: Sealer;
  directory: BrowserDirectory;
  /** Where the authorize page sends people who do not have the extension yet. */
  installUrl: string;
  /** Fetches a Client ID Metadata Document. Replaceable in tests; defaults to a guarded fetch. */
  fetchClientMetadata?: (url: string) => Promise<unknown>;
}

const CLIENT_PREFIX = 'tpc_';
const CODE_PREFIX = 'tpo_';
const TICKET_TTL_MS = 15 * 60_000;
const CODE_TTL_MS = 2 * 60_000;
const SCOPES: Record<AgentAccess, string> = { read: 'tabs:read', control: 'tabs:read tabs:control' };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const METADATA_TTL_MS = 10 * 60_000;
const METADATA_MAX_BYTES = 10_000;
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'blob:', 'about:', 'vbscript:']);

interface ClientRecord {
  /** redirect_uris */
  r: string[];
  /** client_name */
  n: string;
  /** issued at (s) */
  t: number;
  /** random, so two registrations never share an id */
  k: string;
}

interface Ticket {
  cid: string;
  n: string;
  ru: string;
  st?: string;
  cc: string;
  sc: AgentAccess;
  exp: number;
}

interface Code {
  tok: string;
  cid: string;
  ru: string;
  cc: string;
  sc: AgentAccess;
  exp: number;
  jti: string;
}

/**
 * Client ID Metadata Documents (the MCP auth spec's preferred client identity; Claude, Zed and
 * Goose use it): the client_id is an https URL serving the client's metadata. Only plain
 * hostnames over https, small documents and short timeouts, so the relay cannot be aimed at
 * internal addresses or held open.
 */
export function isMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname !== '/' && !url.hash && !url.username && !LOOPBACK.has(url.hostname) && !IP_LITERAL.test(url.hostname) && url.hostname.includes('.');
  } catch {
    return false;
  }
}

class MetadataUnavailableError extends Error {}

async function fetchMetadata(url: string): Promise<unknown> {
  // Workers do not implement redirect: 'error'. Manual mode still refuses every redirect.
  const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Client metadata answered ${response.status}`);
  const text = await response.text();
  if (text.length > METADATA_MAX_BYTES) throw new Error('Client metadata is too large');
  return JSON.parse(text);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...headers },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

function html(body: string, status: number, nonce: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** https anywhere, http only on loopback, and an app's own scheme (cursor://, vscode://). */
export function isAllowedRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || BLOCKED_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** Exact match, except loopback redirects may use any port (RFC 8252 section 7.3). */
function redirectMatches(registered: string, given: string): boolean {
  if (registered === given) return true;
  try {
    const a = new URL(registered);
    const b = new URL(given);
    return (
      a.protocol === 'http:' &&
      b.protocol === 'http:' &&
      LOOPBACK.has(a.hostname) &&
      a.hostname === b.hostname &&
      a.pathname === b.pathname &&
      a.search === b.search
    );
  } catch {
    return false;
  }
}

/** What the person sees as "returns to": a site, an app on this computer, or an app scheme. */
export function describeRedirect(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (url.protocol === 'https:') return url.host;
  if (url.protocol === 'http:') return 'an app on this computer';
  return `the ${url.protocol.slice(0, -1)} app`;
}

async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  }
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

export class OAuthServer {
  readonly resourceMetadataUrl: string;
  private readonly issuer: string;
  private readonly metadataCache = new Map<string, { record: ClientRecord; at: number }>();

  constructor(private readonly options: OAuthOptions) {
    this.issuer = options.publicUrl.replace(/\/+$/, '');
    this.resourceMetadataUrl = `${this.issuer}/.well-known/oauth-protected-resource/mcp`;
  }

  /** Returns a response for OAuth paths, or null for anything else. */
  handle(request: Request, pathname: string): Promise<Response> | null {
    const method = request.method;
    if (method === 'GET' && (pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-protected-resource/mcp')) {
      return Promise.resolve(this.resourceMetadata());
    }
    if (
      method === 'GET' &&
      (pathname === '/.well-known/oauth-authorization-server' ||
        pathname === '/.well-known/oauth-authorization-server/mcp' ||
        pathname === '/.well-known/openid-configuration')
    ) {
      return Promise.resolve(this.serverMetadata());
    }
    if (method === 'POST' && pathname === '/register') return this.register(request);
    if (method === 'GET' && pathname === '/authorize') return this.authorize(new URL(request.url));
    if (method === 'POST' && pathname === '/authorize/complete') return this.complete(request);
    if (method === 'POST' && pathname === '/token') return this.token(request);
    return null;
  }

  private resourceMetadata(): Response {
    return json({
      resource: `${this.issuer}/mcp`,
      authorization_servers: [this.issuer],
      scopes_supported: ['tabs:read', 'tabs:control'],
      bearer_methods_supported: ['header'],
      resource_name: 'Tabpass',
      resource_documentation: `${this.issuer}/llms.txt`,
    });
  }

  private serverMetadata(): Response {
    return json({
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      registration_endpoint: `${this.issuer}/register`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['tabs:read', 'tabs:control'],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      service_documentation: `${this.issuer}/llms.txt`,
    });
  }

  private async register(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : null;
    if (!uris || uris.length === 0 || uris.length > 5 || !uris.every((uri) => typeof uri === 'string' && uri.length <= 500)) {
      return oauthError('invalid_redirect_uri', 'Send 1 to 5 redirect_uris.');
    }
    const redirectUris = uris as string[];
    const bad = redirectUris.find((uri) => !isAllowedRedirect(uri));
    if (bad) return oauthError('invalid_redirect_uri', `Not allowed: ${bad}. Use https, http on localhost, or an app scheme.`);
    const name = typeof body?.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 60) : 'An AI tool';
    const issuedAt = Math.floor(Date.now() / 1000);
    const record: ClientRecord = { r: redirectUris, n: name, t: issuedAt, k: randomToken(9) };
    const clientId = `${CLIENT_PREFIX}${await this.options.sealer.sign(record)}`;
    return json(
      {
        client_id: clientId,
        client_id_issued_at: issuedAt,
        client_name: name,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'tabs:read tabs:control',
      },
      201
    );
  }

  private async client(clientId: string | null): Promise<ClientRecord | null> {
    if (!clientId) return null;
    if (isMetadataUrl(clientId)) return this.metadataClient(clientId);
    if (!clientId.startsWith(CLIENT_PREFIX)) return null;
    const record = await this.options.sealer.verify<ClientRecord>(clientId.slice(CLIENT_PREFIX.length));
    return record && Array.isArray(record.r) && typeof record.n === 'string' ? record : null;
  }

  private async metadataClient(url: string): Promise<ClientRecord | null> {
    const cached = this.metadataCache.get(url);
    if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.record;
    let record: ClientRecord | null = null;
    try {
      const document = (await (this.options.fetchClientMetadata ?? fetchMetadata)(url)) as {
        client_id?: unknown;
        client_name?: unknown;
        redirect_uris?: unknown;
      };
      const uris = Array.isArray(document?.redirect_uris) ? document.redirect_uris : [];
      // The document must name itself, and only list redirects we would accept from registration.
      if (
        document?.client_id === url &&
        uris.length > 0 &&
        uris.length <= 10 &&
        uris.every((uri): uri is string => typeof uri === 'string' && uri.length <= 500 && isAllowedRedirect(uri))
      ) {
        const name = typeof document.client_name === 'string' && document.client_name.trim() ? document.client_name.trim().slice(0, 60) : new URL(url).host;
        record = { r: uris, n: name, t: Math.floor(Date.now() / 1000), k: 'cimd' };
      }
    } catch {
      // Failed transport/JSON must not become a ten-minute cached 'unregistered' result.
      throw new MetadataUnavailableError();
    }
    if (record) {
      if (this.metadataCache.size > 500) this.metadataCache.clear();
      this.metadataCache.set(url, { record, at: Date.now() });
    }
    return record;
  }

  private async authorize(url: URL): Promise<Response> {
    const nonce = randomToken(16);
    const params = url.searchParams;
    let client: ClientRecord | null;
    try {
      client = await this.client(params.get('client_id'));
    } catch (error) {
      if (!(error instanceof MetadataUnavailableError)) throw error;
      return html(renderErrorPage('Tabpass could not check this app right now. Try connecting again.', nonce), 503, nonce);
    }
    if (!client) return html(renderErrorPage('This app is not registered with Tabpass. Try connecting again from the app.', nonce), 400, nonce);
    const redirectUri = params.get('redirect_uri') ?? (client.r.length === 1 ? client.r[0]! : '');
    if (!client.r.some((registered) => redirectMatches(registered, redirectUri))) {
      return html(renderErrorPage('This app asked to return somewhere it did not register. Nothing was shared.', nonce), 400, nonce);
    }

    // From here on, errors go back to the app (RFC 6749 section 4.1.2.1).
    const state = params.get('state') ?? undefined;
    const back = (error: string, description: string): Response => {
      const target = new URL(redirectUri);
      target.searchParams.set('error', error);
      target.searchParams.set('error_description', description);
      if (state) target.searchParams.set('state', state);
      target.searchParams.set('iss', this.issuer);
      return Response.redirect(target.href, 302);
    };
    if (params.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
    const challenge = params.get('code_challenge');
    if (!challenge || params.get('code_challenge_method') !== 'S256') return back('invalid_request', 'PKCE with S256 is required.');
    const resource = params.get('resource');
    if (resource && !resource.startsWith(this.issuer)) return back('invalid_target', 'This server only issues tokens for itself.');

    const access: AgentAccess = (params.get('scope') ?? '').split(/\s+/).includes('tabs:control') ? 'control' : 'read';
    const ticket: Ticket = { cid: params.get('client_id')!, n: client.n, ru: redirectUri, cc: challenge, sc: access, exp: Date.now() + TICKET_TTL_MS, ...(state ? { st: state } : {}) };
    const page = renderAuthorizePage({
      clientName: client.n,
      returnsTo: describeRedirect(redirectUri),
      requestedAccess: access,
      ticket: await this.options.sealer.seal(ticket),
      installUrl: this.options.installUrl,
      nonce,
    });
    return html(page, 200, nonce);
  }

  /** Called by the authorize page once the person approved in Tabpass (or declined). */
  private async complete(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { ticket?: unknown; token?: unknown; access?: unknown; error?: unknown } | null;
    const ticket = typeof body?.ticket === 'string' ? await this.options.sealer.open<Ticket>(body.ticket) : null;
    if (!ticket || ticket.exp < Date.now()) return json({ error: 'This sign-in page expired. Start again from the app.' }, 400);

    const redirect = new URL(ticket.ru);
    if (ticket.st) redirect.searchParams.set('state', ticket.st);
    redirect.searchParams.set('iss', this.issuer);
    if (body?.error !== undefined) {
      redirect.searchParams.set('error', 'access_denied');
      redirect.searchParams.set('error_description', 'The person did not connect Tabpass.');
      return json({ redirect: redirect.href });
    }

    const token = typeof body?.token === 'string' ? body.token : '';
    const parsed = await parseAgentToken(token);
    if (!parsed) return json({ error: 'Tabpass did not send a valid connection.' }, 400);
    // The agent was just registered over the browser's socket; give that message a moment to land.
    let lookup = await this.options.directory.lookupAgent(parsed);
    for (let attempt = 0; lookup.status !== 'ok' && attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      lookup = await this.options.directory.lookupAgent(parsed);
    }
    if (lookup.status !== 'ok') return json({ error: 'Tabpass is not connected to this relay. Check the relay address in Tabpass.' }, 409);

    const code: Code = {
      tok: token,
      cid: ticket.cid,
      ru: ticket.ru,
      cc: ticket.cc,
      sc: lookup.agent.access,
      exp: Date.now() + CODE_TTL_MS,
      jti: randomToken(12),
    };
    redirect.searchParams.set('code', `${CODE_PREFIX}${await this.options.sealer.seal(code)}`);
    return json({ redirect: redirect.href });
  }

  private async token(request: Request): Promise<Response> {
    const form = await readForm(request);
    if (form.grant_type !== 'authorization_code') return oauthError('unsupported_grant_type', 'Only authorization_code is supported.');
    const raw = form.code ?? '';
    const code = raw.startsWith(CODE_PREFIX) ? await this.options.sealer.open<Code>(raw.slice(CODE_PREFIX.length)) : null;
    if (!code || code.exp < Date.now()) return oauthError('invalid_grant', 'The code is invalid or expired.');
    if (form.client_id && form.client_id !== code.cid) return oauthError('invalid_grant', 'The code was issued to another client.');
    if (form.redirect_uri && form.redirect_uri !== code.ru) return oauthError('invalid_grant', 'redirect_uri does not match.');
    if (!form.code_verifier || (await pkceChallenge(form.code_verifier)) !== code.cc) return oauthError('invalid_grant', 'PKCE verification failed.');
    const parsed = await parseAgentToken(code.tok);
    if (!parsed || !(await this.options.directory.consumeCode(parsed.browserId, code.jti, code.exp))) {
      return oauthError('invalid_grant', 'The code was already used.');
    }
    return json({ access_token: code.tok, token_type: 'Bearer', scope: SCOPES[code.sc] });
  }
}
