// The relay's HTTP surface, on Web-standard Request/Response so the Node server and the
// Cloudflare Worker serve exactly the same routes:
//
//   /mcp, /mcp/<token>   MCP for agents (Bearer token, OAuth access token, or token in the path)
//   OAuth                 /.well-known/*, /register, /authorize, /authorize/complete, /token
//   /internal/*           an account provider's servers acting for a person (shared secret)
//   /, /llms.txt, /health

import { runAccountTool } from './account-tools.js';
import { constantTimeEqual, Sealer } from './crypto.js';
import type { BrowserDirectory } from './directory.js';
import { landingPage, llmsTxt } from './info.js';
import { createTokenMcpServer, serveMcp } from './mcp.js';
import { OAuthServer } from './oauth.js';
import { parseAgentToken, redactToken, type ParsedAgentToken } from './tokens.js';
import { accountTools, parseToolArgs } from './tools.js';

export interface RelayAppOptions {
  /** Origin agents and the extension use to reach this relay, e.g. https://tabs.migma.ai */
  publicUrl: string;
  directory: BrowserDirectory;
  /** Turns on OAuth (one URL for every MCP client). At least 32 characters; keep it stable. */
  secret?: string;
  /** Where the OAuth page sends people without the extension. */
  installUrl?: string;
  /** Enables /internal for an account provider (sent by it as a Bearer token). */
  internalSecret?: string;
  /** MCP requests allowed per agent per minute (per process). */
  rateLimitPerMinute?: number;
  log?: (message: string) => void;
}

export interface RelayApp {
  fetch: (request: Request) => Promise<Response>;
}

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_RATE_LIMIT = 300;
const DEFAULT_INSTALL_URL = 'https://github.com/migmaai/tabpass#install';
const ACCOUNT_TOOLS = new Map(accountTools().map((tool) => [tool.name, tool]));

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers } });
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }, status, headers);
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new Error('Body too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('Body too large');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON');
  }
}

class FixedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly limit: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= 60_000) {
      if (this.windows.size > 10_000) this.windows.clear();
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }
}

export function createRelayApp(options: RelayAppOptions): RelayApp {
  const log = options.log ?? ((): void => undefined);
  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  const directory = options.directory;
  const limiter = new FixedWindowLimiter(options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT);
  const oauthReady: Promise<OAuthServer | null> = options.secret
    ? Sealer.fromSecret(options.secret).then(
        (sealer) => new OAuthServer({ publicUrl, sealer, directory, installUrl: options.installUrl ?? DEFAULT_INSTALL_URL })
      )
    : Promise.resolve(null);

  async function extractToken(request: Request, pathname: string): Promise<ParsedAgentToken | null> {
    const header = request.headers.get('authorization');
    if (header?.toLowerCase().startsWith('bearer ')) return parseAgentToken(header.slice(7));
    if (pathname.startsWith('/mcp/')) return parseAgentToken(decodeURIComponent(pathname.slice('/mcp/'.length)));
    return null;
  }

  async function handleMcp(request: Request, pathname: string): Promise<Response> {
    const oauth = await oauthReady;
    const challenge = oauth
      ? `Bearer realm="tabpass", resource_metadata="${oauth.resourceMetadataUrl}"`
      : 'Bearer realm="tabpass"';
    const token = await extractToken(request, pathname);
    if (!token) {
      return jsonRpcError(401, 'Connect this client to Tabpass first: sign in when asked, or use the link from the Tabpass side panel.', {
        'WWW-Authenticate': challenge,
      });
    }
    const lookup = await directory.lookupAgent(token);
    if (lookup.status === 'invalid') {
      return jsonRpcError(401, 'This connection was removed in Tabpass. Connect again.', {
        'WWW-Authenticate': `${challenge}, error="invalid_token"`,
      });
    }
    if (!limiter.allow(token.tokenHash)) return jsonRpcError(429, 'Too many requests. Slow down and try again in a minute.', { 'Retry-After': '60' });
    if (request.method !== 'POST') return jsonRpcError(405, 'Method not allowed.', { Allow: 'POST, OPTIONS' });

    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      return jsonRpcError(400, error instanceof Error ? error.message : 'Bad request');
    }
    // While the browser is offline the relay cannot see the agent's access level, so it lists every
    // tool and each call answers "browser offline".
    const access = lookup.status === 'ok' ? lookup.agent.access : null;
    return withCors(await serveMcp(request, createTokenMcpServer(directory, token, access), body));
  }

  /** Provider-to-relay API. Not for agents: it acts for any person the provider names. */
  async function handleInternal(request: Request, pathname: string): Promise<Response> {
    const header = request.headers.get('authorization') ?? '';
    const given = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
    if (!options.internalSecret || !given || !constantTimeEqual(given, options.internalSecret)) return json({ error: 'Not found' }, 404);
    const parts = pathname.slice('/internal/'.length).split('/').map(decodeURIComponent);
    const [scope, accountId, action, connectionId, verb] = parts;
    if (scope !== 'accounts' || !accountId) return json({ error: 'Not found' }, 404);

    // GET /internal/accounts/:accountId/browsers
    if (request.method === 'GET' && action === 'browsers' && parts.length === 3) {
      return json({ browsers: await directory.accountBrowsers(accountId) });
    }
    // POST /internal/accounts/:accountId/call  { tool, args, via? }
    if (request.method === 'POST' && action === 'call' && parts.length === 3) {
      const body = (await readJson(request)) as { tool?: unknown; args?: unknown; via?: unknown } | undefined;
      const tool = typeof body?.tool === 'string' ? ACCOUNT_TOOLS.get(body.tool) : undefined;
      if (!tool) return json({ error: 'Unknown tool' }, 400);
      const parsed = parseToolArgs(tool, body?.args);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      const via = typeof body?.via === 'string' ? body.via : undefined;
      return json(await runAccountTool(directory, accountId, tool.name, parsed.args, via ? { via } : {}));
    }
    // POST /internal/accounts/:accountId/connections/:connectionId/revoke
    if (request.method === 'POST' && action === 'connections' && connectionId && verb === 'revoke' && parts.length === 5) {
      return json({ revoked: await directory.revokeConnection(accountId, connectionId) });
    }
    return json({ error: 'Not found' }, 404);
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (pathname === '/health') return json({ ok: true, ...(await directory.stats()) });
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) return handleMcp(request, pathname);
    if (pathname.startsWith('/internal/')) return handleInternal(request, pathname);

    const oauth = await oauthReady;
    const handled = oauth?.handle(request, pathname);
    if (handled) return handled;

    if (pathname === '/llms.txt') {
      return new Response(llmsTxt(publicUrl, Boolean(oauth)), { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS } });
    }
    if (pathname === '/') return new Response(landingPage(publicUrl), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return json({ error: 'Not found' }, 404);
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const started = Date.now();
      let response: Response;
      try {
        response = await route(request);
      } catch (error) {
        log(`error: ${error instanceof Error ? error.message : String(error)}`);
        response = json({ error: 'Internal server error' }, 500);
      }
      log(`${request.method} ${redactToken(new URL(request.url).pathname)} ${response.status} ${Date.now() - started}ms`);
      return response;
    },
  };
}
