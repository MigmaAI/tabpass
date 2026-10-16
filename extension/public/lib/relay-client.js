// One outbound WebSocket from this browser to one relay. Wire format: relay/src/protocol.ts.
// A connection can carry the token agents (the relay set under "This browser"), an account
// (e.g. Migma's relay), or both when they are the same relay.
// A message every 20s keeps the MV3 service worker alive while connected (Chrome 116+); an alarm
// reconnects it if Chrome suspended the worker anyway.

import { getAgents, getSettings, setSession } from './store.js';

export const PROTOCOL_VERSION = 1;
const KEEPALIVE_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
const CLOSE_PROTOCOL = 4001;

export function statusKey(relayUrl) {
  return `status:${relayUrl}`;
}

function agentGrants(agents) {
  return agents.map(({ tokenHash, label, access }) => ({ tokenHash, label, access }));
}

export class RelayClient {
  /**
   * roles: { tokens: boolean, account: stored account or null }
   * onCall(message, client) -> tool result; onAccount(account, { status, name }) for welcome/updates.
   */
  constructor({ relayUrl, roles, onCall, onAccount }) {
    this.relayUrl = relayUrl;
    this.roles = roles;
    this.onCall = onCall;
    this.onAccount = onAccount;
    this.socket = null;
    this.keepalive = null;
    this.reconnectTimer = null;
    this.backoffMs = 1000;
    this.stopped = false;
    this.lastError = null;
    this.connecting = null;
  }

  /** Safe to call often: concurrent calls share one attempt. */
  connect() {
    this.connecting ??= this.openSocket().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async openSocket() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.stopped || (this.socket && this.socket.readyState <= WebSocket.OPEN)) return;
    await this.setStatus({ state: 'connecting' });

    let socket;
    try {
      socket = new WebSocket(this.relayUrl);
    } catch {
      await this.setStatus({ state: 'error', message: 'That relay address is not valid.' });
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', async () => {
      const settings = await getSettings();
      const account = this.roles.account;
      this.send({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        browserKey: settings.browserKey,
        extensionVersion: chrome.runtime.getManifest().version,
        browserName: settings.browserName,
        agents: this.roles.tokens ? agentGrants(await getAgents()) : [],
        ...(account ? { account: { connectionId: account.connectionId, secret: account.secret } } : {}),
      });
      clearInterval(this.keepalive);
      this.keepalive = setInterval(() => this.send({ type: 'ping' }), KEEPALIVE_MS);
    });

    socket.addEventListener('message', (event) => this.handleMessage(event.data));

    socket.addEventListener('close', async (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.keepalive);
      if (this.stopped) return;
      if (event.code === CLOSE_PROTOCOL) {
        // The relay refused us (e.g. version mismatch); retrying fast will not help.
        this.backoffMs = MAX_BACKOFF_MS;
        await this.setStatus({ state: 'error', message: this.lastError ?? 'The relay refused this connection.' });
      } else {
        await this.setStatus({ state: 'connecting', message: "Can't reach the relay. Retrying…" });
      }
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    });
  }

  async handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message.type) {
      case 'welcome':
        this.backoffMs = 1000;
        this.lastError = null;
        await this.setStatus({ state: 'connected', browserId: message.browserId, mcpUrl: message.mcpUrl });
        if (this.roles.account && message.account) await this.onAccount(this.roles.account, message.account);
        break;
      case 'account':
        if (this.roles.account) await this.onAccount(this.roles.account, message);
        break;
      case 'call': {
        const result = await this.onCall(message, this);
        this.send({ type: 'result', id: message.id, result });
        break;
      }
      case 'error':
        this.lastError = message.message;
        await this.setStatus({ state: 'error', message: message.message });
        break;
      default:
        break;
    }
  }

  /** Tells the relay which agent tokens are valid right now. */
  async syncAgents() {
    if (this.roles.tokens) this.send({ type: 'agents', agents: agentGrants(await getAgents()) });
  }

  /** New roles need a new hello, so reconnect. */
  async setRoles(roles) {
    this.roles = roles;
    await this.restart();
  }

  async restart() {
    await this.connecting; // let an attempt finish, then replace it
    this.stopped = false;
    this.backoffMs = 1000;
    const socket = this.socket;
    this.socket = null;
    clearInterval(this.keepalive);
    socket?.close();
    await this.connect();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.keepalive);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    await chrome.storage.session.remove(statusKey(this.relayUrl));
  }

  /** Called by the alarm: reconnect if the worker was suspended and the socket is gone. */
  ensureConnected() {
    if (!this.stopped && !this.socket && !this.reconnectTimer) this.connect();
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  async setStatus(status) {
    // One key per relay, so two connections never overwrite each other's status.
    await setSession(statusKey(this.relayUrl), { ...status, relayUrl: this.relayUrl, at: Date.now() });
  }
}
