// Runs the Cloudflare Worker relay in the real Workers runtime (`wrangler dev --local`, workerd)
// and drives it like the extension, an MCP agent and an account provider would.
// Slow to start, so it runs on its own: `yarn test:worker`.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { AccountCredential, ToolResult } from '../src/core/protocol.js';

import { FakeExtension, makeAgent } from './helpers.js';

const RUN = process.env.TABPASS_WORKER === '1';
const RELAY_SECRET = 'worker-test-secret-that-is-long-enough';
const INTERNAL_SECRET = 'worker-internal-secret';
const VERIFY_SECRET = 'worker-verify-secret';

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content).map((item) => item.text ?? '').join('');
}

describe.skipIf(!RUN)('Cloudflare Worker relay (workerd)', () => {
  let wrangler: ChildProcess;
  let verifyServer: Server;
  let base: string;
  let wsBase: string;
  const connections = new Map<string, { secret: string; accountId: string }>();
  let providerDown = false;
  const extensions: FakeExtension[] = [];

  beforeAll(async () => {
    const verifyPort = await freePort();
    verifyServer = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}') as { connectionId?: string; secret?: string };
        const known = body.connectionId ? connections.get(body.connectionId) : undefined;
        const authorized = req.headers.authorization === `Bearer ${VERIFY_SECRET}`;
        const status = providerDown ? 503 : !authorized ? 401 : known && known.secret === body.secret ? 200 : 404;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status === 200 ? { accountId: known!.accountId, name: known!.accountId } : { error: 'no' }));
      });
    });
    await new Promise<void>((resolve) => verifyServer.listen(verifyPort, '127.0.0.1', resolve));

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}/extension`;
    wrangler = spawn(
      'npx',
      [
        'wrangler', 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--show-interactive-dev-session=false',
        '--persist-to', `.wrangler/test-${port}`,
        '--var', `PUBLIC_URL:${base}`,
        '--var', `RELAY_SECRET:${RELAY_SECRET}`,
        '--var', `INTERNAL_SECRET:${INTERNAL_SECRET}`,
        '--var', `ACCOUNTS_VERIFY_URL:http://127.0.0.1:${verifyPort}/verify`,
        '--var', `ACCOUNTS_VERIFY_SECRET:${VERIFY_SECRET}`,
      ],
      { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('wrangler dev did not start')), 60_000);
      const onData = (chunk: Buffer): void => {
        if (chunk.toString().includes('Ready on')) {
          clearTimeout(timer);
          resolve();
        }
      };
      wrangler.stdout?.on('data', onData);
      wrangler.stderr?.on('data', onData);
    });
  }, 90_000);

  afterAll(async () => {
    await Promise.all(extensions.map((extension) => extension.close()));
    wrangler?.kill('SIGTERM');
    verifyServer?.close();
  });

  async function browser(options: { agents?: Awaited<ReturnType<typeof makeAgent>>[]; account?: AccountCredential; name?: string; extension?: FakeExtension } = {}): Promise<FakeExtension> {
    const extension = options.extension ?? new FakeExtension();
    extensions.push(extension);
    await extension.connect(`${wsBase}?browser=${await extension.browserId()}`, options.agents ?? [], {
      account: options.account,
      browserName: options.name,
    });
    return extension;
  }

  async function mcp(token: string): Promise<Client> {
    const client = new Client({ name: 'worker-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
  }

  async function internalCall(accountId: string, tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const response = await fetch(`${base}/internal/accounts/${accountId}/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args, via: 'Claude' }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as ToolResult;
  }

  function issue(accountId: string): AccountCredential {
    const credential = { connectionId: `conn_${randomBytes(6).toString('hex')}`, secret: randomBytes(32).toString('base64url') };
    connections.set(credential.connectionId, { secret: credential.secret, accountId });
    return credential;
  }

  it('welcomes a browser and routes a token agent\'s calls to it', async () => {
    const extension = new FakeExtension();
    const agent = await makeAgent(extension.browserKey, 'Claude', 'read');
    await browser({ extension, agents: [agent] });
    expect(extension.messages[0]).toEqual({ type: 'welcome', browserId: await extension.browserId(), mcpUrl: `${base}/mcp` });
    const client = await mcp(agent.token);
    expect((await client.listTools()).tools).toHaveLength(6);
    expect(textOf(await client.callTool({ name: 'list_tabs', arguments: {} }))).toBe('ok:list_tabs');
    expect(extension.calls[0]).toMatchObject({ tool: 'list_tabs', tokenHash: agent.tokenHash });
    await client.close();
  });

  it('answers pings without waking the browser object', async () => {
    const extension = await browser();
    const since = extension.messages.length;
    extension.send({ type: 'ping' });
    expect(await extension.next('pong', since)).toEqual({ type: 'pong' });
  });

  it('closes a socket that claims another browser id', async () => {
    const victim = new FakeExtension();
    const socket = new WebSocket(`${wsBase}?browser=${await victim.browserId()}`);
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    socket.send(JSON.stringify({ type: 'hello', protocol: 1, browserKey: randomBytes(32).toString('base64url'), extensionVersion: 't', browserName: 'x', agents: [] }));
    expect(await closed).toBe(4001);
  });

  it('says "offline" after the browser leaves, and the newest socket wins on reconnect', async () => {
    const extension = new FakeExtension();
    const agent = await makeAgent(extension.browserKey, 'Claude', 'control');
    await browser({ extension, agents: [agent] });
    const client = await mcp(agent.token);
    await extension.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(textOf(await client.callTool({ name: 'list_tabs', arguments: {} }))).toMatch(/offline/);

    const again = new FakeExtension();
    Object.defineProperty(again, 'browserKey', { value: extension.browserKey });
    again.onCall = (call): void => again.reply(call.id, 'from-new-socket');
    await browser({ extension: again, agents: [agent] });
    expect(textOf(await client.callTool({ name: 'list_tabs', arguments: {} }))).toBe('from-new-socket');
    await client.close();
  });

  it('signs an MCP client in with OAuth and uses the approved token', async () => {
    const extension = new FakeExtension();
    const agent = await makeAgent(extension.browserKey, 'SDK', 'read');
    await browser({ extension, agents: [agent] });
    const redirect = 'http://127.0.0.1:9999/callback';
    let saved: OAuthClientInformationMixed | undefined;
    let tokens: OAuthTokens | undefined;
    let verifier = '';
    let authorization: URL | null = null;
    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return redirect;
      },
      get clientMetadata() {
        return { client_name: 'SDK', redirect_uris: [redirect], token_endpoint_auth_method: 'none' };
      },
      clientInformation: () => saved,
      saveClientInformation: (info) => void (saved = info),
      tokens: () => tokens,
      saveTokens: (next) => void (tokens = next),
      redirectToAuthorization: (url) => void (authorization = url),
      saveCodeVerifier: (value) => void (verifier = value),
      codeVerifier: () => verifier,
    };
    const first = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider });
    await expect(new Client({ name: 'sdk', version: '1' }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    const html = await (await fetch(authorization!.href)).text();
    const ticket = /"ticket":"([^"]+)"/.exec(html)![1];
    const done = await fetch(`${base}/authorize/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, token: agent.token }),
    });
    const code = new URL(((await done.json()) as { redirect: string }).redirect).searchParams.get('code')!;
    await first.finishAuth(code);
    const client = new Client({ name: 'sdk', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider }));
    expect(textOf(await client.callTool({ name: 'list_tabs', arguments: {} }))).toBe('ok:list_tabs');
    await client.close();

    // The code is single-use across the Worker, held by the browser's object.
    const replay = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }).toString(),
    });
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('account mode: verifies, routes by person, picks the browser used last, and revokes', async () => {
    const laptop = await browser({ account: issue('user_alice'), name: 'Chrome on Mac' });
    expect(laptop.messages[0]).toMatchObject({ type: 'welcome', account: { status: 'ok', name: 'user_alice' } });
    const desktopCredential = issue('user_alice');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const desktop = await browser({ account: desktopCredential, name: 'Chrome on Windows' });

    expect(textOf(await internalCall('user_alice', 'list_tabs'))).toBe('ok:list_tabs');
    expect(desktop.calls).toHaveLength(1);
    laptop.send({ type: 'active' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await internalCall('user_alice', 'list_tabs');
    expect(laptop.calls).toHaveLength(1);
    expect(textOf(await internalCall('user_alice', 'list_browsers'))).toMatch(/^- Chrome on Mac \(default\)/);
    expect(textOf(await internalCall('user_bob', 'list_tabs'))).toMatch(/No browser is connected/);

    const revoke = await fetch(`${base}/internal/accounts/user_alice/connections/${desktopCredential.connectionId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(await revoke.json()).toEqual({ revoked: 1 });
    expect(await desktop.next('account')).toEqual({ type: 'account', status: 'invalid' });
    expect(textOf(await internalCall('user_alice', 'list_browsers'))).not.toMatch(/Windows/);
  });

  it('account mode: unknown credentials are invalid, provider outages are not', async () => {
    const stranger = await browser({ account: { connectionId: 'conn_unknown1', secret: randomBytes(32).toString('base64url') } });
    expect(stranger.messages[0]).toMatchObject({ account: { status: 'invalid' } });
    providerDown = true;
    const unlucky = await browser({ account: issue('user_carol') });
    providerDown = false;
    expect(unlucky.messages[0]).toMatchObject({ account: { status: 'unavailable' } });
  });

  it('keeps the internal API closed without the secret', async () => {
    const response = await fetch(`${base}/internal/accounts/user_alice/browsers`, { headers: { Authorization: 'Bearer wrong' } });
    expect(response.status).toBe(404);
  });
});
