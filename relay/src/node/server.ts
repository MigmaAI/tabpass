import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Duplex } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { WebSocketServer } from 'ws';

import type { AccountVerifier } from '../core/accounts.js';
import { createRelayApp, type RelayApp } from '../core/app.js';
import { BROWSER_ID_PATTERN } from '../core/tokens.js';

import { MemoryDirectory } from './memory-directory.js';

export interface RelayOptions {
  /** Origin agents and the extension use to reach this relay, e.g. https://tabs.example.com */
  publicUrl: string;
  /** Turns on OAuth so every MCP client can use one address. At least 32 characters; keep it stable. */
  secret?: string;
  installUrl?: string;
  callTimeoutMs?: number;
  rateLimitPerMinute?: number;
  /** Account mode: verifies the provider credentials browsers present (see core/accounts.ts). */
  accounts?: AccountVerifier;
  reverifyMs?: number;
  /** Enables /internal for the account provider's servers. */
  internalSecret?: string;
  log?: (message: string) => void;
}

export interface Relay {
  directory: MemoryDirectory;
  app: RelayApp;
  /** Handles plain HTTP requests. Mountable in an existing Node or Express server. */
  handleHttp: (req: IncomingMessage, res: ServerResponse) => void;
  /** Handles the WebSocket upgrade on /extension. Returns false for other paths. */
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  close: () => void;
}

export interface RelayServer extends Relay {
  server: Server;
  listen: (port: number, host?: string) => Promise<number>;
}

const MAX_WS_PAYLOAD_BYTES = 32 * 1024 * 1024;

function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
  } as RequestInit);
}

async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>).pipe(res);
}

export function createRelay(options: RelayOptions): Relay {
  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  const directory = new MemoryDirectory({
    mcpUrl: `${publicUrl}/mcp`,
    accounts: options.accounts,
    reverifyMs: options.reverifyMs,
    callTimeoutMs: options.callTimeoutMs,
    log: options.log,
  });
  const app = createRelayApp({
    publicUrl,
    directory,
    secret: options.secret,
    installUrl: options.installUrl,
    internalSecret: options.internalSecret,
    rateLimitPerMinute: options.rateLimitPerMinute,
    log: options.log,
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
  // Requests are built against the public origin so OAuth redirects and metadata use it.
  const origin = new URL(publicUrl).origin;

  return {
    directory,
    app,
    handleHttp: (req, res) => {
      app
        .fetch(toRequest(req, origin))
        .then((response) => sendResponse(res, response))
        .catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
    },
    handleUpgrade: (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://relay.local');
      if (url.pathname !== '/extension') return false;
      const browserId = url.searchParams.get('browser') ?? undefined;
      if (browserId && !BROWSER_ID_PATTERN.test(browserId)) return false;
      wss.handleUpgrade(req, socket, head, (ws) => directory.attach(ws, browserId));
      return true;
    },
    close: () => {
      directory.close();
      wss.close();
    },
  };
}

/** Standalone relay: one HTTP server for every route plus the /extension WebSocket. */
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
    close: () => {
      relay.close();
      server.closeAllConnections();
      server.close();
    },
  };
}
