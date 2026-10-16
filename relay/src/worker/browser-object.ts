import { DurableObject } from 'cloudflare:workers';

import { httpAccountVerifier, type AccountVerifier, type BrowserAccount } from '../core/accounts.js';
import { errorResult, MESSAGES, PendingCalls, type AgentLookup } from '../core/directory.js';
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
} from '../core/protocol.js';
import { browserIdFromKey, hashesEqual } from '../core/tokens.js';

import type { Env } from './env.js';

/** What survives hibernation and restarts, in this object's storage. */
interface Session {
  browserId: string;
  agents: AgentGrant[];
  extensionVersion: string;
  browserName: string;
  connectedAt: number;
  lastActiveAt: number;
  credential?: AccountCredential;
  account?: BrowserAccount;
  verifiedAt: number;
}

const CALL_TIMEOUT_MS = 120_000;
const REVERIFY_MS = 10 * 60_000;
const UNAVAILABLE_RETRY_MS = 60_000;
const CODE_PREFIX = 'code:';
const CLOSE_REPLACED = 4000;
const CLOSE_PROTOCOL = 4001;
const PING = JSON.stringify({ type: 'ping' });
const PONG = JSON.stringify({ type: 'pong' });

/**
 * One per browser (named by its browser id). Holds the extension's WebSocket with the hibernation
 * API, so an idle browser costs nothing: pings are answered by Cloudflare without waking it.
 */
export class BrowserObject extends DurableObject<Env> {
  private session: Session | null = null;
  private readonly pending = new PendingCalls(CALL_TIMEOUT_MS);
  /** Sockets that sent or got a close; Cloudflare may still list them for a moment. */
  private readonly closed = new WeakSet<WebSocket>();
  private readonly verifier: AccountVerifier | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.verifier =
      env.ACCOUNTS_VERIFY_URL && env.ACCOUNTS_VERIFY_SECRET
        ? httpAccountVerifier({ url: env.ACCOUNTS_VERIFY_URL, secret: env.ACCOUNTS_VERIFY_SECRET })
        : null;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      this.session = (await ctx.storage.get<Session>('session')) ?? null;
    });
  }

  /** The extension's socket upgrade, routed here by ?browser=<id>. */
  async fetch(request: Request): Promise<Response> {
    const browserId = new URL(request.url).searchParams.get('browser') ?? '';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ browserId, hello: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') {
      ws.close(CLOSE_PROTOCOL, 'Binary frames are not supported');
      return;
    }
    const message = parseExtensionMessage(raw);
    if (!message) {
      this.send(ws, { type: 'error', message: 'Malformed message' });
      return;
    }
    const attachment = ws.deserializeAttachment() as { browserId: string; hello: boolean };
    if (message.type === 'hello') {
      if (!attachment.hello) await this.hello(ws, message, attachment.browserId);
      return;
    }
    if (!attachment.hello || !this.session) {
      ws.close(CLOSE_PROTOCOL, 'Expected hello');
      return;
    }
    switch (message.type) {
      case 'agents':
        this.session.agents = message.agents;
        await this.save();
        break;
      case 'result':
        this.pending.settle(message.id, this.session.browserId, message.result);
        break;
      case 'active':
        this.session.lastActiveAt = Date.now();
        await this.save();
        if (this.session.account) await this.account(this.session.account.accountId).touch(this.session.browserId, this.session.lastActiveAt);
        break;
      default:
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // With the hibernation API the server finishes the close handshake itself.
    this.closed.add(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'Closed');
    } catch {
      // Already closed.
    }
    await this.disconnected(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.closed.add(ws);
    await this.disconnected(ws);
  }

  /** Re-checks the account now and then, so a revoke made at the provider lands. */
  async alarm(): Promise<void> {
    if (!this.session?.credential || !this.socket()) return;
    const wasBound = Boolean(this.session.account);
    const result = await this.checkAccount();
    const socket = this.socket();
    if (socket && (result.status === 'invalid' || (result.status === 'ok' && !wasBound))) this.send(socket, { type: 'account', ...result });
    await this.scheduleCheck();
  }

  // ---------- RPC from the Worker ----------

  async lookupAgent(tokenHash: string): Promise<AgentLookup> {
    if (!this.session || !this.socket()) return { status: 'offline' };
    const agent = this.session.agents.find((candidate) => hashesEqual(candidate.tokenHash, tokenHash));
    return agent ? { status: 'ok', agent } : { status: 'invalid' };
  }

  async callAgent(tokenHash: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const socket = this.socket();
    if (!this.session || !socket) return errorResult(MESSAGES.offline);
    if (!this.session.agents.some((agent) => hashesEqual(agent.tokenHash, tokenHash))) return errorResult(MESSAGES.removed);
    return this.dispatch(socket, { tool, args, tokenHash });
  }

  /** Null when this browser is no longer connected for that person (the caller tries another). */
  async callAccount(accountId: string, tool: string, args: Record<string, unknown>, via?: string): Promise<ToolResult | null> {
    const socket = this.socket();
    if (!socket || this.session?.account?.accountId !== accountId) return null;
    return this.dispatch(socket, { tool, args, account: via ? { via: via.slice(0, 60) } : {} });
  }

  async revoke(accountId: string, connectionId: string): Promise<number> {
    const session = this.session;
    if (!session?.credential || session.credential.connectionId !== connectionId) return 0;
    if (session.account && session.account.accountId !== accountId) return 0;
    await this.unbind();
    session.credential = undefined;
    await this.save();
    this.pending.failOwner(session.browserId, MESSAGES.revoked);
    const socket = this.socket();
    if (socket) this.send(socket, { type: 'account', status: 'invalid' });
    return socket ? 1 : 0;
  }

  async consumeCode(codeId: string, expiresAt: number): Promise<boolean> {
    const key = `${CODE_PREFIX}${codeId}`;
    if (await this.ctx.storage.get(key)) return false;
    await this.ctx.storage.put(key, expiresAt);
    // Drop codes that can no longer be replayed anyway.
    const now = Date.now();
    for (const [stored, expiry] of await this.ctx.storage.list<number>({ prefix: CODE_PREFIX })) {
      if (expiry < now) await this.ctx.storage.delete(stored);
    }
    return true;
  }

  // ---------- internals ----------

  private socket(): WebSocket | null {
    for (const ws of this.ctx.getWebSockets()) {
      if (this.closed.has(ws) || ws.readyState !== WebSocket.OPEN) continue;
      const attachment = ws.deserializeAttachment() as { hello?: boolean } | null;
      if (attachment?.hello) return ws;
    }
    return null;
  }

  private account(accountId: string): DurableObjectStub<import('./account-object.js').AccountObject> {
    return this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(accountId));
  }

  private async hello(ws: WebSocket, hello: HelloMessage, claimedId: string): Promise<void> {
    if (hello.protocol !== PROTOCOL_VERSION) {
      this.send(ws, { type: 'error', message: `This relay speaks protocol ${PROTOCOL_VERSION}; update the extension or the relay.` });
      ws.close(CLOSE_PROTOCOL, 'Protocol mismatch');
      return;
    }
    const browserId = await browserIdFromKey(hello.browserKey);
    if (browserId !== claimedId) {
      ws.close(CLOSE_PROTOCOL, 'Browser id does not match its key');
      return;
    }
    // A service-worker restart opens a new socket before the old one closes.
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      this.closed.add(other);
      try {
        other.close(CLOSE_REPLACED, 'Replaced by a newer connection');
      } catch {
        // Already closed.
      }
    }
    this.pending.failOwner(browserId, 'The browser reconnected before answering. Try again.');

    const now = Date.now();
    const previousAccount = this.session?.account;
    this.session = {
      browserId,
      agents: hello.agents,
      extensionVersion: hello.extensionVersion,
      browserName: hello.browserName,
      connectedAt: now,
      lastActiveAt: now,
      verifiedAt: 0,
      ...(hello.account ? { credential: hello.account } : {}),
      ...(previousAccount && hello.account?.connectionId === previousAccount.connectionId ? { account: previousAccount } : {}),
    };
    ws.serializeAttachment({ browserId, hello: true });
    if (previousAccount && !this.session.account) await this.account(previousAccount.accountId).unregister(browserId);
    const account = this.session.credential ? await this.checkAccount() : undefined;
    await this.save();
    if (this.session.credential) await this.scheduleCheck();
    this.send(ws, {
      type: 'welcome',
      browserId,
      mcpUrl: `${this.env.PUBLIC_URL.replace(/\/+$/, '')}/mcp`,
      ...(account ? { account } : {}),
    });
  }

  private async checkAccount(): Promise<{ status: AccountStatus; name?: string }> {
    const session = this.session;
    if (!this.verifier || !session?.credential) return { status: 'unsupported' };
    try {
      const account = await this.verifier.verify(session.credential, { browserId: session.browserId, name: session.browserName });
      if (!account) {
        await this.unbind();
        session.credential = undefined;
        await this.save();
        return { status: 'invalid' };
      }
      if (session.account && session.account.accountId !== account.accountId) await this.unbind();
      session.account = account;
      session.verifiedAt = Date.now();
      await this.save();
      await this.account(account.accountId).register({
        browserId: session.browserId,
        name: session.browserName,
        connectedAt: session.connectedAt,
        lastActiveAt: session.lastActiveAt,
      });
      return { status: 'ok', ...(account.name ? { name: account.name } : {}) };
    } catch {
      // Keep the credential, and an earlier verified binding: a provider outage must not
      // disconnect everyone. Try again sooner than usual.
      session.verifiedAt = Date.now() - REVERIFY_MS + UNAVAILABLE_RETRY_MS;
      await this.save();
      return { status: 'unavailable' };
    }
  }

  private async scheduleCheck(): Promise<void> {
    const session = this.session;
    if (!session?.credential) return;
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, session.verifiedAt + REVERIFY_MS));
  }

  private async unbind(): Promise<void> {
    const session = this.session;
    if (!session?.account) return;
    const { accountId } = session.account;
    session.account = undefined;
    await this.account(accountId).unregister(session.browserId);
  }

  private async disconnected(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as { hello?: boolean } | null;
    if (!attachment?.hello || !this.session || this.socket()) return; // a newer socket took over
    this.pending.failOwner(this.session.browserId, MESSAGES.disconnected);
    if (this.session.account) await this.account(this.session.account.accountId).unregister(this.session.browserId);
  }

  private dispatch(socket: WebSocket, call: Pick<CallMessage, 'tool' | 'args' | 'tokenHash' | 'account'>): Promise<ToolResult> {
    return this.pending.start(this.session!.browserId, (id) => this.send(socket, { type: 'call', id, ...call }));
  }

  private async save(): Promise<void> {
    if (this.session) await this.ctx.storage.put('session', this.session);
  }

  private send(ws: WebSocket, message: RelayMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The socket closed under us; the close handler cleans up.
    }
  }
}
