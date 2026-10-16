// One outbound WebSocket from this browser to the relay. Wire format: relay/src/protocol.ts.
// A message every 20s keeps the MV3 service worker alive while connected (Chrome 116+); an alarm
// reconnects it if Chrome suspended the worker anyway.

import { getAgents, getSettings, setSession } from './store.js';

export const PROTOCOL_VERSION = 1;
const KEEPALIVE_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
const CLOSE_PROTOCOL = 4001;

function agentGrants(agents) {
  return agents.map(({ tokenHash, label, access }) => ({ tokenHash, label, access }));
}

export class RelayClient {
  constructor({ onCall }) {
    this.onCall = onCall;
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
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const settings = await getSettings();
    if (!settings.relayUrl) {
      await this.setStatus({ state: 'offline', message: 'Add a relay address under Relay.' });
      return;
    }
    await this.setStatus({ state: 'connecting', relayUrl: settings.relayUrl });

    let socket;
    try {
      socket = new WebSocket(settings.relayUrl);
    } catch {
      await this.setStatus({ state: 'error', message: 'That relay address is not valid.', relayUrl: settings.relayUrl });
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', async () => {
      this.send({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        browserKey: settings.browserKey,
        extensionVersion: chrome.runtime.getManifest().version,
        agents: agentGrants(await getAgents()),
      });
      clearInterval(this.keepalive);
      this.keepalive = setInterval(() => this.send({ type: 'ping' }), KEEPALIVE_MS);
    });

    socket.addEventListener('message', (event) => this.handleMessage(event.data, settings.relayUrl));

    socket.addEventListener('close', async (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.keepalive);
      if (this.stopped) return;
      if (event.code === CLOSE_PROTOCOL) {
        // The relay refused us (e.g. version mismatch); retrying fast will not help.
        this.backoffMs = MAX_BACKOFF_MS;
        await this.setStatus({ state: 'error', message: this.lastError ?? 'The relay refused this connection.', relayUrl: settings.relayUrl });
      } else {
        await this.setStatus({ state: 'connecting', message: "Can't reach the relay. Retrying…", relayUrl: settings.relayUrl });
      }
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    });
  }

  async handleMessage(raw, relayUrl) {
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
        await this.setStatus({ state: 'connected', browserId: message.browserId, mcpUrl: message.mcpUrl, relayUrl });
        break;
      case 'call': {
        const result = await this.onCall(message);
        this.send({ type: 'result', id: message.id, result });
        break;
      }
      case 'error':
        this.lastError = message.message;
        await this.setStatus({ state: 'error', message: message.message, relayUrl });
        break;
      default:
        break;
    }
  }

  /** Tells the relay which agent tokens are valid right now. */
  async syncAgents() {
    this.send({ type: 'agents', agents: agentGrants(await getAgents()) });
  }

  async restart() {
    await this.connecting; // let an attempt with the old address finish, then replace it
    this.stopped = false;
    this.backoffMs = 1000;
    const socket = this.socket;
    this.socket = null;
    clearInterval(this.keepalive);
    socket?.close();
    await this.connect();
  }

  /** Called by the alarm: reconnect if the worker was suspended and the socket is gone. */
  ensureConnected() {
    if (!this.socket && !this.reconnectTimer) this.connect();
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  async setStatus(status) {
    await setSession('status', { ...status, at: Date.now() });
  }
}
