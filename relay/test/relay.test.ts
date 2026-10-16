import { randomBytes } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '../src/core/protocol.js';
import { createRelayServer, type RelayServer } from '../src/node/server.js';
import { browserIdFromKey } from '../src/core/tokens.js';
import { BROWSER_TOOLS } from '../src/core/tools.js';

import { FakeExtension, makeAgent, type FakeAgent } from './helpers.js';

async function connectClient(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );
  await client.connect(transport);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((item) => item.text ?? '').join('');
}

describe('relay', () => {
  let relay: RelayServer;
  let base: string;
  let wsUrl: string;
  const extensions: FakeExtension[] = [];
  const clients: Client[] = [];

  beforeEach(async () => {
    relay = createRelayServer({ publicUrl: 'https://tabs.example.com', callTimeoutMs: 1500 });
    const port = await relay.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/extension`;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
    await Promise.all(extensions.splice(0).map((extension) => extension.close()));
    relay.close();
  });

  async function startExtension(agents: (key: string) => Promise<FakeAgent[]> | FakeAgent[]): Promise<{ extension: FakeExtension; agents: FakeAgent[] }> {
    const extension = new FakeExtension();
    extensions.push(extension);
    const created = await agents(extension.browserKey);
    await extension.connect(wsUrl, created);
    return { extension, agents: created };
  }

  async function client(url: string, token?: string): Promise<Client> {
    const connected = await connectClient(url, token);
    clients.push(connected);
    return connected;
  }

  it('welcomes the extension with its browser id and the public MCP url', async () => {
    const extension = new FakeExtension();
    extensions.push(extension);
    const welcome = await extension.connect(wsUrl, []);
    expect(welcome).toEqual({
      type: 'welcome',
      browserId: await browserIdFromKey(extension.browserKey),
      mcpUrl: 'https://tabs.example.com/mcp',
    });
  });

  it('forwards tool calls to the browser that owns the token and returns its result', async () => {
    const { extension, agents } = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'control')]);
    const agent = agents[0]!;
    const mcp = await client(`${base}/mcp`, agent.token);

    const tools = await mcp.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(BROWSER_TOOLS.map((tool) => tool.name).sort());

    const result = await mcp.callTool({ name: 'read_page', arguments: { tabId: 7, interactive: true } });
    expect(textOf(result)).toBe('ok:read_page');
    expect(extension.calls).toHaveLength(1);
    expect(extension.calls[0]).toMatchObject({
      tool: 'read_page',
      tokenHash: agent.tokenHash,
      args: { tabId: 7, interactive: true },
    });
  });

  it('passes screenshots through as image content', async () => {
    const { extension, agents } = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'read')]);
    extension.onCall = (call): void =>
      extension.send({
        type: 'result',
        id: call.id,
        result: { content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' }] },
      });
    const mcp = await client(`${base}/mcp`, agents[0]!.token);
    const result = await mcp.callTool({ name: 'screenshot', arguments: {} });
    expect(result.content).toEqual([{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' }]);
  });

  it('shows read-only agents only the read tools', async () => {
    const { agents } = await startExtension(async (key) => [await makeAgent(key, 'Migma', 'read')]);
    const mcp = await client(`${base}/mcp`, agents[0]!.token);
    const names = (await mcp.listTools()).tools.map((tool) => tool.name);
    expect(names.sort()).toEqual(['extract_design', 'get_selection', 'list_tabs', 'read_page', 'screenshot', 'wait_for']);
  });

  it('accepts the token in the URL path for connector UIs that only take a URL', async () => {
    const { agents } = await startExtension(async (key) => [await makeAgent(key, 'ChatGPT', 'read')]);
    const mcp = await client(`${base}/mcp/${agents[0]!.token}`);
    expect(textOf(await mcp.callTool({ name: 'list_tabs', arguments: {} }))).toBe('ok:list_tabs');
  });

  it('rejects a token the browser did not register', async () => {
    const { extension } = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'control')]);
    const stranger = await makeAgent(extension.browserKey, 'Stranger', 'control');
    await expect(connectClient(`${base}/mcp`, stranger.token)).rejects.toThrow(/401|was removed/);
  });

  it('rejects requests without a well-formed token', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');

    const malformed = await fetch(`${base}/mcp/not-a-token`, { method: 'POST', body: '{}' });
    expect(malformed.status).toBe(401);
  });

  it('answers "browser offline" when the browser is not connected', async () => {
    const browserKey = randomBytes(32).toString('base64url');
    const agent = await makeAgent(browserKey, 'Claude', 'control');
    const mcp = await client(`${base}/mcp`, agent.token);
    const result = await mcp.callTool({ name: 'list_tabs', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/offline/);
  });

  it('stops serving an agent once the browser removes it', async () => {
    const { extension, agents } = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'control')]);
    const agent = agents[0]!;
    const mcp = await client(`${base}/mcp`, agent.token);
    expect(textOf(await mcp.callTool({ name: 'list_tabs', arguments: {} }))).toBe('ok:list_tabs');

    extension.send({ type: 'agents', agents: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(mcp.callTool({ name: 'list_tabs', arguments: {} })).rejects.toThrow(/401|was removed/);
  });

  it('times out when the browser never answers', async () => {
    const { extension, agents } = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'control')]);
    extension.onCall = (): void => undefined;
    const mcp = await client(`${base}/mcp`, agents[0]!.token);
    const result = await mcp.callTool({ name: 'list_tabs', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/did not answer/);
    expect((await relay.directory.stats()).pendingCalls).toBe(0);
  });

  it('fails the pending call when the browser disconnects', async () => {
    const { extension, agents } = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'control')]);
    extension.onCall = (): void => {
      extension.socket.close();
    };
    const mcp = await client(`${base}/mcp`, agents[0]!.token);
    const result = await mcp.callTool({ name: 'list_tabs', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/disconnected/);
  });

  it('ignores results a browser sends for calls it was never given', async () => {
    const victim = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'control')]);
    const attacker = await startExtension(() => []);
    victim.extension.onCall = (call): void => {
      attacker.extension.reply(call.id, 'spoofed');
      setTimeout(() => victim.extension.reply(call.id, 'genuine'), 20);
    };
    const mcp = await client(`${base}/mcp`, victim.agents[0]!.token);
    expect(textOf(await mcp.callTool({ name: 'list_tabs', arguments: {} }))).toBe('genuine');
  });

  it('routes calls to the newest connection after a reconnect', async () => {
    const { extension, agents } = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'control')]);
    const second = new FakeExtension();
    Object.defineProperty(second, 'browserKey', { value: extension.browserKey });
    extensions.push(second);
    await second.connect(wsUrl, agents);
    second.onCall = (call): void => second.reply(call.id, 'from-second');

    const mcp = await client(`${base}/mcp`, agents[0]!.token);
    expect(textOf(await mcp.callTool({ name: 'list_tabs', arguments: {} }))).toBe('from-second');
    expect((await relay.directory.stats()).browsers).toBe(1);
  });

  it('closes connections that speak another protocol version', async () => {
    const extension = new FakeExtension();
    extensions.push(extension);
    const message = await extension.connect(wsUrl, [], { protocol: PROTOCOL_VERSION + 1 });
    expect(message.type).toBe('error');
    await new Promise<void>((resolve) => extension.socket.once('close', () => resolve()));
  });

  it('validates tool arguments before they reach the browser', async () => {
    const { extension, agents } = await startExtension(async (key) => [await makeAgent(key, 'Claude', 'control')]);
    const mcp = await client(`${base}/mcp`, agents[0]!.token);
    const result = await mcp.callTool({ name: 'open_tab', arguments: { url: 'not a url' } });
    expect(result.isError).toBe(true);
    expect(extension.calls).toHaveLength(0);
  });

  it('reports health', async () => {
    await startExtension(() => []);
    const response = await fetch(`${base}/health`);
    expect(await response.json()).toEqual({ ok: true, browsers: 1, accounts: 0, pendingCalls: 0 });
  });
});
