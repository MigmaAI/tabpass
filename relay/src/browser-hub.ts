import { randomUUID } from 'node:crypto';

import type { WebSocket } from 'ws';

import {
  PROTOCOL_VERSION,
  parseExtensionMessage,
  type AgentGrant,
  type CallMessage,
  type RelayMessage,
  type ToolResult,
} from './protocol.js';
import { browserIdFromKey, hashesEqual, type ParsedAgentToken } from './tokens.js';

export interface BrowserHubOptions {
  /** Public MCP endpoint, sent to the extension so it can show agents where to connect. */
  mcpUrl: string;
  /** How long a tool call may take, including the user answering a site-access prompt. */
  callTimeoutMs?: number;
  /** A socket that has not said hello within this window is dropped. */
  helloTimeoutMs?: number;
  /** Interval for WebSocket-level pings that detect dead connections. */
  heartbeatMs?: number;
  log?: (message: string) => void;
}

interface BrowserConnection {
  browserId: string;
  socket: WebSocket;
  agents: AgentGrant[];
  extensionVersion: string;
  connectedAt: number;
  alive: boolean;
}

interface PendingCall {
  browserId: string;
  resolve: (result: ToolResult) => void;
  timer: NodeJS.Timeout;
}

export type AgentLookup =
  | { status: 'ok'; agent: AgentGrant }
  | { status: 'offline' }
  | { status: 'invalid' };

const DEFAULT_CALL_TIMEOUT_MS = 120_000;
const DEFAULT_HELLO_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const CLOSE_REPLACED = 4000;
const CLOSE_PROTOCOL = 4001;

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Holds the live extension connections (one per browser) and correlates tool calls with results. */
export class BrowserHub {
  private readonly browsers = new Map<string, BrowserConnection>();
  private readonly pending = new Map<string, PendingCall>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly callTimeoutMs: number;
  private readonly helloTimeoutMs: number;
  private readonly log: (message: string) => void;

  constructor(private readonly options: BrowserHubOptions) {
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
    this.log = options.log ?? ((): void => undefined);
    this.heartbeat = setInterval(() => this.checkHeartbeats(), options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Takes ownership of a freshly upgraded extension socket. */
  attach(socket: WebSocket): void {
    let connection: BrowserConnection | null = null;
    const helloTimer = setTimeout(() => {
      if (!connection) socket.close(CLOSE_PROTOCOL, 'Expected hello');
    }, this.helloTimeoutMs);

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(CLOSE_PROTOCOL, 'Binary frames are not supported');
        return;
      }
      const message = parseExtensionMessage(data.toString());
      if (!message) {
        this.send(socket, { type: 'error', message: 'Malformed message' });
        return;
      }

      if (message.type === 'hello') {
        if (message.protocol !== PROTOCOL_VERSION) {
          this.send(socket, {
            type: 'error',
            message: `This relay speaks protocol ${PROTOCOL_VERSION}; update the extension or the relay.`,
          });
          socket.close(CLOSE_PROTOCOL, 'Protocol mismatch');
          return;
        }
        clearTimeout(helloTimer);
        connection = this.register(socket, message.browserKey, message.extensionVersion, message.agents);
        return;
      }

      if (!connection) {
        socket.close(CLOSE_PROTOCOL, 'Expected hello');
        return;
      }

      switch (message.type) {
        case 'agents':
          connection.agents = message.agents;
          break;
        case 'result':
          this.settle(message.id, connection.browserId, message.result);
          break;
        case 'ping':
          connection.alive = true;
          this.send(socket, { type: 'pong' });
          break;
      }
    });

    socket.on('pong', () => {
      if (connection) connection.alive = true;
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (connection && this.browsers.get(connection.browserId) === connection) {
        this.browsers.delete(connection.browserId);
        this.failPending(connection.browserId, 'The browser disconnected before answering.');
        this.log(`browser ${connection.browserId} disconnected`);
      }
    });

    socket.on('error', () => socket.terminate());
  }

  lookupAgent(token: ParsedAgentToken): AgentLookup {
    const browser = this.browsers.get(token.browserId);
    if (!browser) return { status: 'offline' };
    const agent = browser.agents.find((candidate) => hashesEqual(candidate.tokenHash, token.tokenHash));
    return agent ? { status: 'ok', agent } : { status: 'invalid' };
  }

  /** Forwards one tool call to the browser and waits for its result. Never rejects. */
  call(token: ParsedAgentToken, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const browser = this.browsers.get(token.browserId);
    if (!browser) {
      return Promise.resolve(
        errorResult('The browser is offline. Open Chrome with the Migma Tabs extension, then try again.')
      );
    }
    if (!browser.agents.some((agent) => hashesEqual(agent.tokenHash, token.tokenHash))) {
      return Promise.resolve(errorResult('This agent was removed in the browser. Ask the user to connect it again.'));
    }

    const id = randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(errorResult(`The browser did not answer within ${Math.round(this.callTimeoutMs / 1000)}s.`));
      }, this.callTimeoutMs);
      this.pending.set(id, { browserId: token.browserId, resolve, timer });
      const message: CallMessage = { type: 'call', id, tokenHash: token.tokenHash, tool, args };
      this.send(browser.socket, message);
    });
  }

  stats(): { browsers: number; pendingCalls: number } {
    return { browsers: this.browsers.size, pendingCalls: this.pending.size };
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const id of this.pending.keys()) this.settle(id, null, errorResult('The relay is shutting down.'));
    for (const browser of this.browsers.values()) browser.socket.close(1001, 'Relay shutting down');
    this.browsers.clear();
  }

  private register(
    socket: WebSocket,
    browserKey: string,
    extensionVersion: string,
    agents: AgentGrant[]
  ): BrowserConnection {
    const browserId = browserIdFromKey(browserKey);
    const previous = this.browsers.get(browserId);
    if (previous && previous.socket !== socket) {
      // A service-worker restart opens a new socket before the old one times out.
      this.browsers.delete(browserId);
      this.failPending(browserId, 'The browser reconnected before answering. Try again.');
      previous.socket.close(CLOSE_REPLACED, 'Replaced by a newer connection');
    }

    const connection: BrowserConnection = {
      browserId,
      socket,
      agents,
      extensionVersion,
      connectedAt: Date.now(),
      alive: true,
    };
    this.browsers.set(browserId, connection);
    this.send(socket, { type: 'welcome', browserId, mcpUrl: this.options.mcpUrl });
    this.log(`browser ${browserId} connected (extension ${extensionVersion}, ${agents.length} agents)`);
    return connection;
  }

  private settle(id: string, browserId: string | null, result: ToolResult): void {
    const call = this.pending.get(id);
    // A browser may only answer calls that were sent to it.
    if (!call || (browserId !== null && call.browserId !== browserId)) return;
    clearTimeout(call.timer);
    this.pending.delete(id);
    call.resolve(result);
  }

  private failPending(browserId: string, message: string): void {
    for (const [id, call] of this.pending) {
      if (call.browserId === browserId) this.settle(id, browserId, errorResult(message));
    }
  }

  private checkHeartbeats(): void {
    for (const browser of this.browsers.values()) {
      if (!browser.alive) {
        browser.socket.terminate();
        continue;
      }
      browser.alive = false;
      browser.socket.ping();
    }
  }

  private send(socket: WebSocket, message: RelayMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
