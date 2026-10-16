import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { httpAccountVerifier, type AccountVerifier, type BrowserAccount, type PresentingBrowser } from '../src/accounts.js';
import type { AccountCredential, ToolResult } from '../src/protocol.js';
import { createRelayServer, type RelayServer } from '../src/server.js';

import { FakeExtension, makeAgent } from './helpers.js';

const INTERNAL_SECRET = 'internal-secret-for-tests';

function credential(): AccountCredential {
  return { connectionId: `conn_${randomBytes(6).toString('hex')}`, secret: randomBytes(32).toString('base64url') };
}

/** A provider (like Migma) that knows which connection belongs to which person. */
class FakeProvider implements AccountVerifier {
  readonly connections = new Map<string, { secret: string; accountId: string; name: string }>();
  readonly seen: PresentingBrowser[] = [];
  down = false;

  issue(accountId: string, name = accountId): AccountCredential {
    const issued = credential();
    this.connections.set(issued.connectionId, { secret: issued.secret, accountId, name });
    return issued;
  }

  async verify(given: AccountCredential, browser: PresentingBrowser): Promise<BrowserAccount | null> {
    this.seen.push(browser);
    if (this.down) throw new Error('provider down');
    const known = this.connections.get(given.connectionId);
    if (!known || known.secret !== given.secret) return null;
    return { accountId: known.accountId, connectionId: given.connectionId, name: known.name };
  }
}

function textOf(result: ToolResult): string {
  return result.content.map((item) => (item.type === 'text' ? item.text : '')).join('');
}

describe('account mode', () => {
  let relay: RelayServer;
  let base: string;
  let wsUrl: string;
  let provider: FakeProvider;
  const extensions: FakeExtension[] = [];

  async function start(): Promise<void> {
    provider = new FakeProvider();
    relay = createRelayServer({
      publicUrl: 'https://tabs.example.com',
      accounts: provider,
      internalSecret: INTERNAL_SECRET,
      callTimeoutMs: 1500,
    });
    const port = await relay.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/extension`;
  }

  beforeEach(async () => {
    await start();
  });

  afterEach(async () => {
    await Promise.all(extensions.splice(0).map((extension) => extension.close()));
    relay.close();
  });

  async function browser(account?: AccountCredential, browserName?: string): Promise<FakeExtension> {
    const extension = new FakeExtension();
    extensions.push(extension);
    await extension.connect(wsUrl, [], { account, browserName });
    return extension;
  }

  async function internal(path: string, init: { method?: string; body?: unknown; secret?: string } = {}): Promise<Response> {
    return fetch(`${base}/internal/${path}`, {
      method: init.method ?? 'POST',
      headers: { Authorization: `Bearer ${init.secret ?? INTERNAL_SECRET}`, 'Content-Type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  async function callFor(accountId: string, tool: string, args: Record<string, unknown> = {}, via?: string): Promise<ToolResult> {
    const response = await internal(`accounts/${accountId}/call`, { body: { tool, args, via } });
    expect(response.status).toBe(200);
    return (await response.json()) as ToolResult;
  }

  it('verifies the account on hello and tells the browser who it is connected as', async () => {
    const extension = await browser(provider.issue('user_alice', 'Alice'), 'Chrome on Mac');
    const welcome = await extension.next('welcome');
    expect(welcome.account).toEqual({ status: 'ok', name: 'Alice' });
    expect(provider.seen[0]).toEqual({ browserId: extension.browserId, name: 'Chrome on Mac' });
    expect(relay.hub.stats().accounts).toBe(1);
  });

  it('routes a call for a person to their browser, marked as an account call', async () => {
    const extension = await browser(provider.issue('user_alice'));
    const result = await callFor('user_alice', 'read_page', { tabId: 3 }, 'Claude');
    expect(textOf(result)).toBe('ok:read_page');
    expect(extension.calls[0]).toMatchObject({ tool: 'read_page', args: { tabId: 3 }, account: { via: 'Claude' } });
    expect(extension.calls[0]?.tokenHash).toBeUndefined();
  });

  it('never routes one teammate\'s call to another teammate\'s browser', async () => {
    const alice = await browser(provider.issue('user_alice'));
    const bob = await browser(provider.issue('user_bob'));
    await callFor('user_bob', 'list_tabs');
    expect(bob.calls).toHaveLength(1);
    expect(alice.calls).toHaveLength(0);

    const nobody = await callFor('user_carol', 'list_tabs');
    expect(nobody.isError).toBe(true);
    expect(textOf(nobody)).toMatch(/No browser is connected/);
  });

  it('rejects an unknown credential and tells the browser to forget it', async () => {
    const extension = await browser(credential());
    expect((await extension.next('welcome')).account).toEqual({ status: 'invalid' });
    expect(relay.hub.stats().accounts).toBe(0);
  });

  it('keeps token agents working on the same connection', async () => {
    const extension = new FakeExtension();
    extensions.push(extension);
    const agent = makeAgent(extension.browserKey, 'Claude', 'read');
    await extension.connect(wsUrl, [agent], { account: provider.issue('user_alice') });
    await callFor('user_alice', 'list_tabs');
    expect(relay.hub.lookupAgent({ browserId: extension.browserId, tokenHash: agent.tokenHash }).status).toBe('ok');
  });

  it('uses the most recently active of several browsers, or the one named', async () => {
    const laptop = await browser(provider.issue('user_alice'), 'Chrome on Mac');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const desktop = await browser(provider.issue('user_alice'), 'Chrome on Windows');

    await callFor('user_alice', 'list_tabs');
    expect(desktop.calls).toHaveLength(1);

    laptop.send({ type: 'active' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await callFor('user_alice', 'list_tabs');
    expect(laptop.calls).toHaveLength(1);

    await callFor('user_alice', 'read_page', { browser: 'chrome on windows', tabId: 1 });
    expect(desktop.calls).toHaveLength(2);
    expect(desktop.calls[1]?.args).toEqual({ tabId: 1 }); // `browser` is consumed by the relay

    const listed = textOf(await callFor('user_alice', 'list_browsers'));
    expect(listed).toMatch(/^- Chrome on Mac \(default\): last used/);
    expect(listed).toMatch(/- Chrome on Windows: last used/);

    const missing = await callFor('user_alice', 'list_tabs', { browser: 'Firefox' });
    expect(textOf(missing)).toBe('No connected browser called "Firefox". Connected: Chrome on Mac, Chrome on Windows.');
  });

  it('revoking a connection cuts it off at once and fails its pending call', async () => {
    const issued = provider.issue('user_alice');
    const extension = await browser(issued);
    extension.onCall = (): void => undefined; // never answers
    const pending = callFor('user_alice', 'list_tabs');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await internal(`connections/${issued.connectionId}/revoke`);
    expect(await response.json()).toEqual({ revoked: 1 });
    expect(textOf(await pending)).toMatch(/connection to this browser was removed/);
    expect(await extension.next('account')).toEqual({ type: 'account', status: 'invalid' });
    expect(textOf(await callFor('user_alice', 'list_tabs'))).toMatch(/No browser is connected/);
  });

  it('a provider outage keeps the credential (unavailable), and the browser binds once it recovers', async () => {
    relay.close();
    provider = new FakeProvider();
    relay = createRelayServer({
      publicUrl: 'https://tabs.example.com',
      accounts: provider,
      internalSecret: INTERNAL_SECRET,
      reverifyMs: 100_000,
    });
    // Drive the heartbeat by hand instead of waiting for timers.
    const hub = relay.hub as unknown as { tick: () => void; browsers: Map<string, { verifiedAt: number }> };
    const port = await relay.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/extension`;

    const issued = provider.issue('user_alice');
    provider.down = true;
    const extension = await browser(issued);
    expect((await extension.next('welcome')).account).toEqual({ status: 'unavailable' });
    expect(textOf(await callFor('user_alice', 'list_tabs'))).toMatch(/No browser is connected/);

    provider.down = false;
    for (const connection of hub.browsers.values()) connection.verifiedAt = 0;
    const since = extension.messages.length;
    hub.tick();
    expect(await extension.next('account', since)).toEqual({ type: 'account', status: 'ok', name: 'user_alice' });
    expect(textOf(await callFor('user_alice', 'list_tabs'))).toBe('ok:list_tabs');

    // Once verified, a later outage does not disconnect the person.
    provider.down = true;
    for (const connection of hub.browsers.values()) connection.verifiedAt = 0;
    hub.tick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(textOf(await callFor('user_alice', 'list_tabs'))).toBe('ok:list_tabs');

    // A revoke at the provider lands on the next check.
    provider.down = false;
    provider.connections.clear();
    for (const connection of hub.browsers.values()) connection.verifiedAt = 0;
    const beforeRevoke = extension.messages.length;
    hub.tick();
    expect(await extension.next('account', beforeRevoke)).toEqual({ type: 'account', status: 'invalid' });
  });

  it('hides the internal API without the right secret, and validates tool calls', async () => {
    await browser(provider.issue('user_alice'));
    expect((await internal('accounts/user_alice/call', { body: { tool: 'list_tabs' }, secret: 'wrong' })).status).toBe(404);
    expect((await fetch(`${base}/internal/accounts/user_alice/browsers`)).status).toBe(404);
    expect((await internal('accounts/user_alice/call', { body: { tool: 'rm_rf' } })).status).toBe(400);
    const badArgs = await internal('accounts/user_alice/call', { body: { tool: 'open_tab', args: { url: 'nope' } } });
    expect(badArgs.status).toBe(400);

    const browsers = await internal('accounts/user_alice/browsers', { method: 'GET' });
    expect((await browsers.json()).browsers).toHaveLength(1);
  });

  it('turns the internal API off entirely when no secret is configured', async () => {
    relay.close();
    relay = createRelayServer({ publicUrl: 'https://tabs.example.com', accounts: provider });
    const port = await relay.listen(0, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${port}/internal/accounts/user_alice/browsers`, {
      headers: { Authorization: 'Bearer ' },
    });
    expect(response.status).toBe(404);
  });

  it('a relay without a provider answers "unsupported" and keeps serving token agents', async () => {
    relay.close();
    relay = createRelayServer({ publicUrl: 'https://tabs.example.com' });
    const port = await relay.listen(0, '127.0.0.1');
    const extension = new FakeExtension();
    extensions.push(extension);
    await extension.connect(`ws://127.0.0.1:${port}/extension`, [], { account: credential() });
    expect((await extension.next('welcome')).account).toEqual({ status: 'unsupported' });
  });
});

describe('httpAccountVerifier', () => {
  let server: Server;
  let url: string;
  let status = 200;
  let lastRequest: { auth?: string; body: unknown } | null = null;

  beforeEach(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        lastRequest = { auth: req.headers.authorization, body: JSON.parse(raw) };
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status === 200 ? { accountId: 'user_alice', name: 'Alice' } : { error: 'x' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/verify`;
  });

  afterEach(() => {
    server.close();
  });

  const given = { connectionId: 'conn_12345678', secret: 'a'.repeat(43) };
  const presenting = { browserId: 'AbCdEfGhIjKlMnOp', name: 'Chrome on Mac' };

  it('sends the credential with the presenting browser and the relay secret', async () => {
    const verifier = httpAccountVerifier({ url, secret: 's3cret' });
    expect(await verifier.verify(given, presenting)).toEqual({ accountId: 'user_alice', connectionId: 'conn_12345678', name: 'Alice' });
    expect(lastRequest).toEqual({ auth: 'Bearer s3cret', body: { ...given, browserId: presenting.browserId, browserName: presenting.name } });
  });

  it('treats only 404 and 410 as revoked', async () => {
    const verifier = httpAccountVerifier({ url, secret: 's3cret' });
    for (const code of [404, 410]) {
      status = code;
      expect(await verifier.verify(given, presenting)).toBeNull();
    }
    // A wrong relay secret (401/403) or a server error must not wipe anyone's connection.
    for (const code of [401, 403, 500, 502]) {
      status = code;
      await expect(verifier.verify(given, presenting)).rejects.toThrow(String(code));
    }
    status = 200;
  });
});
