import type { WebSocket } from 'ws';

import type { AccountVerifier, BrowserAccount } from '../core/accounts.js';
import {
  chooseBrowser,
  errorResult,
  MESSAGES,
  PendingCalls,
  type AccountBrowser,
  type AccountCallOptions,
  type AgentLookup,
  type BrowserDirectory,
  type DirectoryStats,
} from '../core/directory.js';
import {
  PROTOCOL_VERSION,
  parseExtensionMessage,
  type AccountCredential,
  type AccountStatus,
  type AgentGrant,
  type CallMessage,
  type ExtensionMessage,
  type HelloMessage,
  type RelayMessage,
  type ToolResult,
} from '../core/protocol.js';
import { browserIdFromKey, hashesEqual, type ParsedAgentToken } from '../core/tokens.js';

export interface MemoryDirectoryOptions {
  /** Public MCP endpoint, sent to the extension so it can show agents where to connect. */
  mcpUrl: string;
  /** Verifies account credentials (account mode). Without it, browsers can only serve token agents. */
  accounts?: AccountVerifier;
  /** How often a connected browser's account is checked again, so a revoke made elsewhere lands. */
  reverifyMs?: number;
  /** How long a tool call may take, including the person answering a site-access prompt. */
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

const DEFAULT_CALL_TIMEOUT_MS = 120_000;
const DEFAULT_HELLO_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_REVERIFY_MS = 10 * 60_000;
const UNAVAILABLE_RETRY_MS = 60_000;
const CLOSE_REPLACED = 4000;
const CLOSE_PROTOCOL = 4001;

/** The Node relay's directory: every browser connection in this one process. */
export class MemoryDirectory implements BrowserDirectory {
  private readonly browsers = new Map<string, BrowserConnection>();
  private readonly byAccount = new Map<string, Set<string>>();
  private readonly usedCodes = new Map<string, number>();
  private readonly pending: PendingCalls;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly helloTimeoutMs: number;
  private readonly reverifyMs: number;
  private readonly log: (message: string) => void;

  constructor(private readonly options: MemoryDirectoryOptions) {
    this.pending = new PendingCalls(options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
    this.helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
    this.reverifyMs = options.reverifyMs ?? DEFAULT_REVERIFY_MS;
    this.log = options.log ?? ((): void => undefined);
    this.heartbeat = setInterval(() => this.tick(), options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /**
   * Takes ownership of a freshly upgraded extension socket. `expectedBrowserId` comes from the
   * `?browser=` query; when given, the hello must prove that id or the socket is closed.
   */
  attach(socket: WebSocket, expectedBrowserId?: string): void {
    let ready: Promise<BrowserConnection | null> | null = null;
    const helloTimer = setTimeout(() => {
      if (!ready) socket.close(CLOSE_PROTOCOL, 'Expected hello');
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
        if (ready) return; // one hello per socket
        clearTimeout(helloTimer);
        ready = this.hello(socket, message, expectedBrowserId);
        return;
      }
      if (!ready) {
        socket.close(CLOSE_PROTOCOL, 'Expected hello');
        return;
      }
      void ready.then((connection) => {
        if (connection) this.handle(connection, message);
      });
    });

    socket.on('pong', () => {
      void ready?.then((connection) => {
        if (connection) connection.alive = true;
      });
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      void ready?.then((connection) => {
        if (connection && this.browsers.get(connection.browserId) === connection) {
          this.browsers.delete(connection.browserId);
          this.unbind(connection);
          this.pending.failOwner(connection.browserId, MESSAGES.disconnected);
          this.log(`browser ${connection.browserId} disconnected`);
        }
      });
    });

    socket.on('error', () => socket.terminate());
  }

  // ---------- BrowserDirectory ----------

  async lookupAgent(token: ParsedAgentToken): Promise<AgentLookup> {
    const browser = this.browsers.get(token.browserId);
    if (!browser) return { status: 'offline' };
    const agent = browser.agents.find((candidate) => hashesEqual(candidate.tokenHash, token.tokenHash));
    return agent ? { status: 'ok', agent } : { status: 'invalid' };
  }

  async callAgent(token: ParsedAgentToken, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const browser = this.browsers.get(token.browserId);
    if (!browser) return errorResult(MESSAGES.offline);
    if (!browser.agents.some((agent) => hashesEqual(agent.tokenHash, token.tokenHash))) return errorResult(MESSAGES.removed);
    return this.dispatch(browser, { tool, args, tokenHash: token.tokenHash });
  }

  async accountBrowsers(accountId: string): Promise<AccountBrowser[]> {
    return [...(this.byAccount.get(accountId) ?? [])]
      .map((browserId) => this.browsers.get(browserId))
      .filter((browser): browser is BrowserConnection => Boolean(browser?.account))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map(({ browserId, browserName, connectedAt, lastActiveAt }) => ({ browserId, name: browserName, connectedAt, lastActiveAt }));
  }

  async callAccount(
    accountId: string,
    tool: string,
    args: Record<string, unknown>,
    options: AccountCallOptions = {}
  ): Promise<ToolResult> {
    const choice = chooseBrowser(await this.accountBrowsers(accountId), options.browser);
    if ('error' in choice) return errorResult(choice.error);
    const browser = this.browsers.get(choice.browser.browserId);
    if (!browser || browser.account?.accountId !== accountId) return errorResult('That browser just disconnected. Try again.');
    return this.dispatch(browser, { tool, args, account: options.via ? { via: options.via.slice(0, 60) } : {} });
  }

  async revokeConnection(accountId: string, connectionId: string): Promise<number> {
    let revoked = 0;
    for (const browser of this.browsers.values()) {
      if (browser.credential?.connectionId !== connectionId) continue;
      if (browser.account && browser.account.accountId !== accountId) continue;
      this.unbind(browser);
      browser.credential = undefined;
      this.pending.failOwner(browser.browserId, MESSAGES.revoked);
      this.send(browser.socket, { type: 'account', status: 'invalid' });
      revoked += 1;
    }
    return revoked;
  }

  async consumeCode(_browserId: string, codeId: string, expiresAt: number): Promise<boolean> {
    const now = Date.now();
    for (const [id, expiry] of this.usedCodes) if (expiry < now) this.usedCodes.delete(id);
    if (this.usedCodes.has(codeId)) return false;
    this.usedCodes.set(codeId, expiresAt);
    return true;
  }

  async stats(): Promise<DirectoryStats> {
    return { browsers: this.browsers.size, accounts: this.byAccount.size, pendingCalls: this.pending.size };
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.pending.failAll('The relay is shutting down.');
    for (const browser of this.browsers.values()) browser.socket.close(1001, 'Relay shutting down');
    this.browsers.clear();
    this.byAccount.clear();
  }

  // ---------- internals ----------

  private async hello(socket: WebSocket, hello: HelloMessage, expectedBrowserId?: string): Promise<BrowserConnection | null> {
    if (hello.protocol !== PROTOCOL_VERSION) {
      this.send(socket, { type: 'error', message: `This relay speaks protocol ${PROTOCOL_VERSION}; update the extension or the relay.` });
      socket.close(CLOSE_PROTOCOL, 'Protocol mismatch');
      return null;
    }
    const browserId = await browserIdFromKey(hello.browserKey);
    if (expectedBrowserId && expectedBrowserId !== browserId) {
      socket.close(CLOSE_PROTOCOL, 'Browser id does not match its key');
      return null;
    }
    const connection = this.register(socket, browserId, hello);
    const account = connection.credential ? await this.checkAccount(connection) : undefined;
    if (this.browsers.get(browserId) === connection) {
      this.send(socket, { type: 'welcome', browserId, mcpUrl: this.options.mcpUrl, ...(account ? { account } : {}) });
    }
    return connection;
  }

  private handle(connection: BrowserConnection, message: ExtensionMessage): void {
    switch (message.type) {
      case 'agents':
        connection.agents = message.agents;
        break;
      case 'result':
        this.pending.settle(message.id, connection.browserId, message.result);
        break;
      case 'ping':
        connection.alive = true;
        this.send(connection.socket, { type: 'pong' });
        break;
      case 'active':
        connection.lastActiveAt = Date.now();
        break;
      default:
        break;
    }
  }

  private register(socket: WebSocket, browserId: string, hello: HelloMessage): BrowserConnection {
    const previous = this.browsers.get(browserId);
    if (previous && previous.socket !== socket) {
      // A service-worker restart opens a new socket before the old one times out.
      this.browsers.delete(browserId);
      this.unbind(previous);
      this.pending.failOwner(browserId, 'The browser reconnected before answering. Try again.');
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

  private dispatch(browser: BrowserConnection, call: Pick<CallMessage, 'tool' | 'args' | 'tokenHash' | 'account'>): Promise<ToolResult> {
    return this.pending.start(browser.browserId, (id) => this.send(browser.socket, { type: 'call', id, ...call }));
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
      if (browser.credential && !browser.checking && now - browser.verifiedAt >= this.reverifyMs) void this.recheck(browser);
    }
  }

  private async recheck(browser: BrowserConnection): Promise<void> {
    const wasBound = Boolean(browser.account);
    const result = await this.checkAccount(browser);
    if (this.browsers.get(browser.browserId) !== browser) return;
    if (result.status === 'invalid' || (result.status === 'ok' && !wasBound)) this.send(browser.socket, { type: 'account', ...result });
  }

  private send(socket: WebSocket, message: RelayMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
