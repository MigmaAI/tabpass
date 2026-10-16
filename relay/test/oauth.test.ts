import { createHash, randomBytes } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRelayServer, type RelayServer } from '../src/node/server.js';

import { FakeExtension, makeAgent, type FakeAgent } from './helpers.js';

const SECRET = 'a-relay-secret-that-is-long-enough-for-tests';
const REDIRECT = 'http://127.0.0.1:9999/callback';

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** What the authorize page does in the browser once Tabpass approved: hand the token back. */
async function approveInBrowser(authorizeUrl: string, token: string): Promise<URL> {
  const page = await fetch(authorizeUrl);
  expect(page.status).toBe(200);
  const html = await page.text();
  const ticket = /"ticket":"([^"]+)"/.exec(html)?.[1];
  expect(ticket).toBeTruthy();
  const origin = new URL(authorizeUrl).origin;
  const done = await fetch(`${origin}/authorize/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket, token }),
  });
  expect(done.status).toBe(200);
  return new URL((await json<{ redirect: string }>(done)).redirect);
}

describe('OAuth: one URL for every MCP client', () => {
  let relay: RelayServer;
  let base: string;
  let wsUrl: string;
  let extension: FakeExtension;
  let agent: FakeAgent;

  beforeEach(async () => {
    relay = createRelayServer({ publicUrl: 'http://127.0.0.1:0', secret: SECRET, installUrl: 'https://example.com/install' });
    const port = await relay.listen(0, '127.0.0.1');
    relay.close();
    relay = createRelayServer({ publicUrl: `http://127.0.0.1:${port}`, secret: SECRET, installUrl: 'https://example.com/install' });
    await relay.listen(port, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/extension`;
    extension = new FakeExtension();
    agent = await makeAgent(extension.browserKey, 'Claude Code', 'read');
    await extension.connect(wsUrl, [agent]);
  });

  afterEach(async () => {
    await extension.close();
    relay.close();
  });

  async function register(redirectUris: string[] = [REDIRECT], name = 'Claude Code'): Promise<Response> {
    return fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: redirectUris, client_name: name, token_endpoint_auth_method: 'none' }),
    });
  }

  function authorizeUrl(clientId: string, challenge: string, extra: Record<string, string> = {}): string {
    const url = new URL(`${base}/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      ...extra,
    }).toString();
    return url.href;
  }

  async function token(body: Record<string, string>): Promise<Response> {
    return fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  }

  it('points unauthenticated MCP clients at the resource metadata', async () => {
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer realm="tabpass", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`
    );
    const resource = await json<{ resource: string; authorization_servers: string[] }>(
      await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)
    );
    expect(resource).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    const server = await json<Record<string, unknown>>(await fetch(`${base}/.well-known/oauth-authorization-server`));
    expect(server).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  it('registers clients without storing anything, and refuses unsafe redirects', async () => {
    const ok = await register([REDIRECT, 'https://claude.ai/api/mcp/auth_callback', 'cursor://anysphere.cursor-retrieval/oauth/callback']);
    expect(ok.status).toBe(201);
    expect((await json<{ client_id: string }>(ok)).client_id).toMatch(/^tpc_/);
    for (const bad of ['http://evil.example.com/cb', 'javascript:alert(1)', 'data:text/html,hi', 'https://ok.example.com/cb#frag']) {
      const refused = await register([bad]);
      expect(refused.status, bad).toBe(400);
    }
  });

  it('runs the whole flow: register, authorize in the browser, exchange with PKCE, use the token', async () => {
    const { client_id } = await json<{ client_id: string }>(await register());
    const { verifier, challenge } = pkce();
    const page = await fetch(authorizeUrl(client_id, challenge));
    expect(page.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);
    const html = await page.text();
    expect(html).toContain('Connect Claude Code to your browser');
    expect(html).toContain('an app on this computer');

    const redirect = await approveInBrowser(authorizeUrl(client_id, challenge), agent.token);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT);
    expect(redirect.searchParams.get('state')).toBe('xyz');
    expect(redirect.searchParams.get('iss')).toBe(base);
    const code = redirect.searchParams.get('code')!;
    expect(code).toMatch(/^tpo_/);
    expect(code).not.toContain(agent.token.slice(3));

    const exchanged = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get('cache-control')).toBe('no-store');
    const tokens = await json<{ access_token: string; token_type: string; scope: string }>(exchanged);
    expect(tokens).toEqual({ access_token: agent.token, token_type: 'Bearer', scope: 'tabs:read' });

    const replay = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT });
    expect(await json<{ error: string }>(replay)).toMatchObject({ error: 'invalid_grant' });
  });

  it('rejects a wrong PKCE verifier, another client, or another redirect', async () => {
    const { client_id } = await json<{ client_id: string }>(await register());
    const { verifier, challenge } = pkce();
    const code = (await approveInBrowser(authorizeUrl(client_id, challenge), agent.token)).searchParams.get('code')!;
    const other = await json<{ client_id: string }>(await register());
    const cases: Record<string, string>[] = [
      { code_verifier: pkce().verifier, client_id, redirect_uri: REDIRECT },
      { code_verifier: verifier, client_id: other.client_id, redirect_uri: REDIRECT },
      { code_verifier: verifier, client_id, redirect_uri: 'http://127.0.0.1:9999/other' },
    ];
    for (const extra of cases) {
      const response = await token({ grant_type: 'authorization_code', code, ...extra });
      expect(response.status).toBe(400);
      expect((await json<{ error: string }>(response)).error).toBe('invalid_grant');
    }
    expect((await json<{ error: string }>(await token({ grant_type: 'refresh_token', refresh_token: 'x' }))).error).toBe(
      'unsupported_grant_type'
    );
  });

  it('sends errors back to the app once the redirect is trusted, and shows a page before that', async () => {
    const { client_id } = await json<{ client_id: string }>(await register());
    const noPkce = await fetch(authorizeUrl(client_id, '', { code_challenge_method: 'plain' }), { redirect: 'manual' });
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');

    const foreign = await fetch(authorizeUrl(client_id, pkce().challenge, { redirect_uri: 'https://evil.example.com/cb' }), { redirect: 'manual' });
    expect(foreign.status).toBe(400);
    expect(await foreign.text()).toContain('did not register');

    const unknown = await fetch(authorizeUrl('tpc_forged.forged', pkce().challenge), { redirect: 'manual' });
    expect(unknown.status).toBe(400);

    // Loopback redirects may come back on another port (RFC 8252).
    const otherPort = await fetch(authorizeUrl(client_id, pkce().challenge, { redirect_uri: 'http://127.0.0.1:5555/callback' }));
    expect(otherPort.status).toBe(200);
  });

  it('declining in Tabpass returns access_denied to the app', async () => {
    const { client_id } = await json<{ client_id: string }>(await register());
    const html = await (await fetch(authorizeUrl(client_id, pkce().challenge))).text();
    const ticket = /"ticket":"([^"]+)"/.exec(html)![1];
    const done = await fetch(`${base}/authorize/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, error: 'access_denied' }),
    });
    const redirect = new URL((await json<{ redirect: string }>(done)).redirect);
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('state')).toBe('xyz');
    expect(redirect.searchParams.get('code')).toBeNull();
  });

  it('works with the official MCP SDK client, start to finish', async () => {
    let saved: OAuthClientInformationMixed | undefined;
    let tokens: OAuthTokens | undefined;
    let verifier = '';
    let pendingAuthorization: URL | null = null;
    const provider: OAuthClientProvider = {
      get redirectUrl(): string {
        return REDIRECT;
      },
      get clientMetadata(): OAuthClientMetadata {
        return { client_name: 'SDK test client', redirect_uris: [REDIRECT], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' };
      },
      clientInformation: () => saved,
      saveClientInformation: (info) => {
        saved = info;
      },
      tokens: () => tokens,
      saveTokens: (next) => {
        tokens = next;
      },
      redirectToAuthorization: (url) => {
        pendingAuthorization = url;
      },
      saveCodeVerifier: (value) => {
        verifier = value;
      },
      codeVerifier: () => verifier,
    };

    const first = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider });
    await expect(new Client({ name: 'sdk', version: '1' }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(pendingAuthorization).not.toBeNull();
    const redirect = await approveInBrowser(pendingAuthorization!.href, agent.token);
    await first.finishAuth(redirect.searchParams.get('code')!);
    expect(tokens?.access_token).toBe(agent.token);

    const client = new Client({ name: 'sdk', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider }));
    const result = await client.callTool({ name: 'list_tabs', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'ok:list_tabs' }]);
    await client.close();
  });

  it('serves setup instructions for AI agents at /llms.txt', async () => {
    const text = await (await fetch(`${base}/llms.txt`)).text();
    expect(text).toContain(`claude mcp add --transport http tabpass ${base}/mcp`);
    expect(text).toContain('OAuth 2.1');
    expect(text).toContain('list_tabs');
  });
});

describe('OAuth: Client ID Metadata Documents', () => {
  const CLIENT = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
  let relay: RelayServer;
  let base: string;
  const documents = new Map<string, unknown>([
    [CLIENT, { client_id: CLIENT, client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }],
    ['https://evil.example.com/meta', { client_id: 'https://someone-else.example.com/meta', redirect_uris: ['https://evil.example.com/cb'] }],
  ]);

  beforeEach(async () => {
    relay = createRelayServer({
      publicUrl: 'http://127.0.0.1',
      secret: SECRET,
      fetchClientMetadata: async (url) => {
        if (!documents.has(url)) throw new Error('404');
        return documents.get(url);
      },
    });
    const port = await relay.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(() => relay.close());

  function authorize(clientId: string, redirect: string): Promise<Response> {
    const url = new URL(`${base}/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
    }).toString();
    return fetch(url, { redirect: 'manual' });
  }

  it('advertises support and accepts a client named by its metadata URL', async () => {
    const metadata = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    const page = await authorize(CLIENT, 'https://claude.ai/api/mcp/auth_callback');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Connect Claude to your browser');
    expect(html).toContain('claude.ai');
  });

  it('refuses a document that names another client, an unlisted redirect, or an unsafe URL', async () => {
    expect((await authorize('https://evil.example.com/meta', 'https://evil.example.com/cb')).status).toBe(400);
    expect((await authorize(CLIENT, 'https://evil.example.com/cb')).status).toBe(400);
    expect((await authorize('https://unknown.example.com/meta', 'https://claude.ai/api/mcp/auth_callback')).status).toBe(400);
  });
});

describe('isMetadataUrl', () => {
  it('only takes https URLs on real hostnames', async () => {
    const { isMetadataUrl } = await import('../src/core/oauth.js');
    expect(isMetadataUrl('https://claude.ai/oauth/meta.json')).toBe(true);
    for (const bad of ['http://claude.ai/meta', 'https://127.0.0.1/meta', 'https://localhost/meta', 'https://[::1]/meta', 'https://intranet/meta', 'https://claude.ai/', 'https://u:p@claude.ai/meta']) {
      expect(isMetadataUrl(bad), bad).toBe(false);
    }
  });
});
