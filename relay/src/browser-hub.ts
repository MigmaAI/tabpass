import { randomUUID } from 'node:crypto';

import type { WebSocket } from 'ws';

import type { AccountVerifier, BrowserAccount } from './accounts.js';
import {
  PROTOCOL_VERSION,
  parseExtensionMessage,
  type AccountCredential,
  type AccountStatus,
  type AgentGrant,
  type CallMessage,
  type HelloMessage,
  type RelayMessage,
  type ToolResult,
} from './protocol.js';
import { browserIdFromKey, hashesEqual, type ParsedAgentToken } from './tokens.js';

export interface BrowserHubOptions {
  /** Public MCP endpoint, sent to the extension so it can show agents where to connect. */
  mcpUrl: string;
  /** Verifies account credentials (account mode). Without it, browsers can only serve token agents. */
  accounts?: AccountVerifier;
  /** How often a connected browser's account is checked again, so a revoke made elsewhere lands. */
  reverifyMs?: number;
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
  browserName: string;
  connectedAt: number;
  lastActiveAt: number;
  alive: boolean;
  credential?: AccountCredential;
  account?: BrowserAccount;
  verifiedAt: number;
  checking: boolean;
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

export interface AccountBrowser {
  browserId: string;
  name: string;
  connectedAt: number;
  lastActiveAt: number;
}

export interface AccountCallOptions {
  /** Browser id or name from accountBrowsers(). Default: the most recently active one. */
  browser?: string;
  /** Name of the client the call came from, e.g. "Claude", shown in the extension's activity. */
  via?: string;
}

const DEFAULT_CALL_TIMEOUT_MS = 120_000;
const DEFAULT_HELLO_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_REVERIFY_MS = 10 * 60_000;
const UNAVAILABLE_RETRY_MS = 60_000;
const CLOSE_REPLACED = 4000;
const CLOSE_PROTOCOL = 4001;

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Holds the live extension connections and correlates tool calls with results. */
export class BrowserHub {
  private readonly browsers = new Map<string, BrowserConnection>();
  private readonly byAccount = new Map<string, Set<string>>();
  private readonly pending = new Map<string, PendingCall>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly callTimeoutMs: number;
  private readonly helloTimeoutMs: number;
  private readonly reverifyMs: number;
  private readonly log: (message: string) => void;

  constructor(private readonly options: BrowserHubOptions) {
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
    this.reverifyMs = options.reverifyMs ?? DEFAULT_REVERIFY_MS;
    this.log = options.log ?? ((): void => undefined);
    this.heartbeat = setInterval(() => this.tick(), options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
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
        if (connection) return; // one hello per socket
        clearTimeout(helloTimer);
        connection = this.register(socket, message);
        void this.welcome(connection);
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
        case 'active':
          connection.lastActiveAt = Date.now();
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
        this.unbind(connection);
        this.failPending(connection.browserId, 'The browser disconnected before answering.');
        this.log(`browser ${connection.browserId} disconnected`);
      }
    });

    socket.on('error', () => socket.terminate());
  }

  // ---------- token agents ----------

  lookupAgent(token: ParsedAgentToken): AgentLookup {
    const browser = this.browsers.get(token.browserId);
    if (!browser) return { status: 'offline' };
    const agent = browser.agents.find((candidate) => hashesEqual(candidate.tokenHash, token.tokenHash));
    return agent ? { status: 'ok', agent } : { status: 'invalid' };
  }

  /** Forwards one token agent's tool call to its browser and waits for the result. Never rejects. */
  call(token: ParsedAgentToken, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const browser = this.browsers.get(token.browserId);
    if (!browser) {
      return Promise.resolve(errorResult('The browser is offline. Open Chrome with the Tabpass extension, then try again.'));
    }
    if (!browser.agents.some((agent) => hashesEqual(agent.tokenHash, token.tokenHash))) {
      return Promise.resolve(errorResult('This agent was removed in the browser. Ask the user to connect it again.'));
    }
    return this.dispatch(browser, { tool, args, tokenHash: token.tokenHash });
  }

  // ---------- account mode ----------

  /** The person's browsers that are online on this relay, most recently active first. */
  accountBrowsers(accountId: string): AccountBrowser[] {
    return [...(this.byAccount.get(accountId) ?? [])]
      .map((browserId) => this.browsers.get(browserId))
      .filter((browser): browser is BrowserConnection => Boolean(browser?.account))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map(({ browserId, browserName, connectedAt, lastActiveAt }) => ({
        browserId,
        name: browserName,
        connectedAt,
        lastActiveAt,
      }));
  }

  /** Runs a tool in one of the person's browsers. Never rejects. */
  callAccount(
    accountId: string,
    tool: string,
    args: Record<string, unknown>,
    options: AccountCallOptions = {}
  ): Promise<ToolResult> {
    const browsers = this.accountBrowsers(accountId);
    if (!browsers.length) {
      return Promise.resolve(
        errorResult('No browser is connected for this person right now. Ask them to open Chrome with Tabpass and connect it.')
      );
    }
    let chosen = browsers[0];
    if (options.browser) {
      const wanted = options.browser.trim().toLowerCase();
      chosen = browsers.find((b) => b.browserId === options.browser || b.name.toLowerCase() === wanted);
      if (!chosen) {
        return Promise.resolve(
          errorResult(`No connected browser called "${options.browser}". Connected: ${browsers.map((b) => b.name).join(', ')}.`)
        );
      }
    }
    const browser = this.browsers.get(chosen!.browserId);
    if (!browser) return Promise.resolve(errorResult('That browser just disconnected. Try again.'));
    return this.dispatch(browser, { tool, args, account: options.via ? { via: options.via.slice(0, 60) } : {} });
  }

  /** Cuts a connection off now (e.g. the person removed it in the provider's settings). */
  revokeConnection(connectionId: string): number {
    let revoked = 0;
    for (const browser of this.browsers.values()) {
      if (browser.credential?.connectionId !== connectionId) continue;
      this.unbind(browser);
      browser.credential = undefined;
      this.failPending(browser.browserId, 'The connection to this browser was removed.');
      this.send(browser.socket, { type: 'account', status: 'invalid' });
      revoked += 1;
    }
    return revoked;
  }

  stats(): { browsers: number; accounts: number; pendingCalls: number } {
    return { browsers: this.browsers.size, accounts: this.byAccount.size, pendingCalls: this.pending.size };
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const id of this.pending.keys()) this.settle(id, null, errorResult('The relay is shutting down.'));
    for (const browser of this.browsers.values()) browser.socket.close(1001, 'Relay shutting down');
    this.browsers.clear();
    this.byAccount.clear();
  }

  // ---------- internals ----------

  private register(socket: WebSocket, hello: HelloMessage): BrowserConnection {
    const browserId = browserIdFromKey(hello.browserKey);
    const previous = this.browsers.get(browserId);
    if (previous && previous.socket !== socket) {
      // A service-worker restart opens a new socket before the old one times out.
      this.browsers.delete(browserId);
      this.unbind(previous);
      this.failPending(browserId, 'The browser reconnected before answering. Try again.');
      previous.socket.close(CLOSE_REPLACED, 'Replaced by a newer connection');
    }

    const now = Date.now();
    const connection: BrowserConnection = {
      browserId,
      socket,
      agents: hello.agents,
      extensionVersion: hello.extensionVersion,
      browserName: hello.browserName,
      connectedAt: now,
      lastActiveAt: now,
      alive: true,
      credential: hello.account,
      verifiedAt: 0,
      checking: false,
    };
    this.browsers.set(browserId, connection);
    this.log(`browser ${browserId} connected (extension ${hello.extensionVersion}, ${hello.agents.length} agents${hello.account ? ', account' : ''})`);
    return connection;
  }

  private async welcome(connection: BrowserConnection): Promise<void> {
    const account = connection.credential ? await this.checkAccount(connection) : undefined;
    if (this.browsers.get(connection.browserId) !== connection) return;
    this.send(connection.socket, {
      type: 'welcome',
      browserId: connection.browserId,
      mcpUrl: this.options.mcpUrl,
      ...(account ? { account } : {}),
    });
  }

  private async checkAccount(connection: BrowserConnection): Promise<{ status: AccountStatus; name?: string }> {
    const verifier = this.options.accounts;
    const credential = connection.credential;
    if (!verifier || !credential) return { status: 'unsupported' };
    connection.checking = true;
    try {
      const account = await verifier.verify(credential, { browserId: connection.browserId, name: connection.browserName });
      if (!account) {
        this.unbind(connection);
        connection.credential = undefined;
        return { status: 'invalid' };
      }
      this.bind(connection, account);
      connection.verifiedAt = Date.now();
      return { status: 'ok', ...(account.name ? { name: account.name } : {}) };
    } catch (error) {
      // Keep the credential, and an earlier verified binding: a provider outage must not
      // disconnect everyone. Revokes made during the outage still land through revokeConnection.
      connection.verifiedAt = Date.now() - this.reverifyMs + UNAVAILABLE_RETRY_MS;
      this.log(`account check failed for ${connection.browserId}: ${error instanceof Error ? error.message : String(error)}`);
      return { status: 'unavailable' };
    } finally {
      connection.checking = false;
    }
  }

  private bind(connection: BrowserConnection, account: BrowserAccount): void {
    if (connection.account && connection.account.accountId !== account.accountId) this.unbind(connection);
    connection.account = account;
    let set = this.byAccount.get(account.accountId);
    if (!set) {
      set = new Set();
      this.byAccount.set(account.accountId, set);
    }
    set.add(connection.browserId);
  }

  private unbind(connection: BrowserConnection): void {
    const accountId = connection.account?.accountId;
    connection.account = undefined;
    if (!accountId) return;
    const set = this.byAccount.get(accountId);
    set?.delete(connection.browserId);
    if (set && set.size === 0) this.byAccount.delete(accountId);
  }

  private dispatch(
    browser: BrowserConnection,
    call: Pick<CallMessage, 'tool' | 'args' | 'tokenHash' | 'account'>
  ): Promise<ToolResult> {
    const id = randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(errorResult(`The browser did not answer within ${Math.round(this.callTimeoutMs / 1000)}s.`));
      }, this.callTimeoutMs);
      this.pending.set(id, { browserId: browser.browserId, resolve, timer });
      this.send(browser.socket, { type: 'call', id, ...call });
    });
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

  private tick(): void {
    const now = Date.now();
    for (const browser of this.browsers.values()) {
      if (!browser.alive) {
        browser.socket.terminate();
        continue;
      }
      browser.alive = false;
      browser.socket.ping();
      if (browser.credential && !browser.checking && now - browser.verifiedAt >= this.reverifyMs) {
        void this.recheck(browser);
      }
    }
  }

  private async recheck(browser: BrowserConnection): Promise<void> {
    const wasBound = Boolean(browser.account);
    const result = await this.checkAccount(browser);
    if (this.browsers.get(browser.browserId) !== browser) return;
    if (result.status === 'invalid' || (result.status === 'ok' && !wasBound)) {
      this.send(browser.socket, { type: 'account', ...result });
    }
  }

  private send(socket: WebSocket, message: RelayMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
