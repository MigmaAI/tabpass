import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer } from 'ws';

import { BrowserHub } from './browser-hub.js';
import { serveMcpRequest } from './mcp-handler.js';
import { parseAgentToken, redactToken, type ParsedAgentToken } from './tokens.js';

export interface RelayOptions {
  /** Origin agents and the extension use to reach this relay, e.g. https://tabs.example.com */
  publicUrl: string;
  callTimeoutMs?: number;
  /** MCP requests allowed per agent per minute. */
  rateLimitPerMinute?: number;
  log?: (message: string) => void;
}

export interface Relay {
  hub: BrowserHub;
  /** Handles plain HTTP requests (health, /mcp). Mountable in an existing node/Express server. */
  handleHttp: (req: IncomingMessage, res: ServerResponse) => void;
  /** Handles the WebSocket upgrade on /extension. Returns false for other paths. */
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  close: () => void;
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_WS_PAYLOAD_BYTES = 32 * 1024 * 1024;
const EXTENSION_PATH = '/extension';
const MCP_PATH = '/mcp';
const DEFAULT_RATE_LIMIT = 300;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
};

class FixedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly limit: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= 60_000) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 10_000) this.prune(now);
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= 60_000) this.windows.delete(key);
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code: -32001, message }, id: null }, headers);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Bearer header first; `/mcp/<token>` for clients that only take a URL (Claude.ai, ChatGPT connectors). */
function extractToken(req: IncomingMessage, pathname: string): ParsedAgentToken | null {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith('bearer ')) return parseAgentToken(header.slice(7));
  if (pathname.startsWith(`${MCP_PATH}/`)) return parseAgentToken(decodeURIComponent(pathname.slice(MCP_PATH.length + 1)));
  return null;
}

export function createRelay(options: RelayOptions): Relay {
  const log = options.log ?? ((): void => undefined);
  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  const hub = new BrowserHub({ mcpUrl: `${publicUrl}${MCP_PATH}`, callTimeoutMs: options.callTimeoutMs, log });
  const limiter = new FixedWindowLimiter(options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });

  async function handleMcp(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const token = extractToken(req, pathname);
    if (!token) {
      jsonRpcError(res, 401, 'Missing or malformed token. Copy the connection details from the Migma Tabs side panel.', {
        'WWW-Authenticate': 'Bearer realm="migma-tabs"',
      });
      return;
    }

    const lookup = hub.lookupAgent(token);
    if (lookup.status === 'invalid') {
      jsonRpcError(res, 401, 'This token is not connected to the browser. It may have been removed.', {
        'WWW-Authenticate': 'Bearer realm="migma-tabs", error="invalid_token"',
      });
      return;
    }
    if (!limiter.allow(token.tokenHash)) {
      jsonRpcError(res, 429, 'Too many requests. Slow down and try again in a minute.', { 'Retry-After': '60' });
      return;
    }
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream and no sessions to delete.
      jsonRpcError(res, 405, 'Method not allowed.', { Allow: 'POST, OPTIONS' });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      jsonRpcError(res, 400, error instanceof Error ? error.message : 'Bad request');
      return;
    }

    for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
    // While the browser is offline the relay cannot see the agent's access level, so it lists every
    // tool and each call answers "browser offline".
    const access = lookup.status === 'ok' ? lookup.agent.access : null;
    await serveMcpRequest(req, res, body, hub, token, access);
  }

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://relay.local');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const started = Date.now();
    res.once('finish', () => {
      log(`${req.method} ${redactToken(pathname)} ${res.statusCode} ${Date.now() - started}ms`);
    });

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (pathname === '/health') {
      sendJson(res, 200, { ok: true, ...hub.stats() });
      return;
    }
    if (pathname === MCP_PATH || pathname.startsWith(`${MCP_PATH}/`)) {
      handleMcp(req, res, pathname).catch((error: unknown) => {
        log(`mcp error: ${error instanceof Error ? error.message : String(error)}`);
        if (!res.headersSent) jsonRpcError(res, 500, 'Internal server error');
      });
      return;
    }
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        `Migma Tabs relay\n\nAgents connect to ${publicUrl}${MCP_PATH} with the token from the extension's side panel.\n`
      );
      return;
    }
    sendJson(res, 404, { error: 'Not found' });
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? '/', 'http://relay.local');
    if (url.pathname !== EXTENSION_PATH) return false;
    wss.handleUpgrade(req, socket, head, (ws) => hub.attach(ws));
    return true;
  }

  return {
    hub,
    handleHttp,
    handleUpgrade,
    close: (): void => {
      hub.close();
      wss.close();
    },
  };
}

export interface RelayServer extends Relay {
  server: Server;
  listen: (port: number, host?: string) => Promise<number>;
}

/** Standalone relay: one HTTP server for /mcp and the /extension WebSocket. */
export function createRelayServer(options: RelayOptions): RelayServer {
  const relay = createRelay(options);
  const server = createServer(relay.handleHttp);
  server.on('upgrade', (req, socket, head) => {
    if (!relay.handleUpgrade(req, socket, head)) socket.destroy();
  });

  return {
    ...relay,
    server,
    listen: (port: number, host?: string): Promise<number> =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      }),
    close: (): void => {
      relay.close();
      server.closeAllConnections();
      server.close();
    },
  };
}
