// Keeps one RelayClient per relay address. Token agents live on the relay set under "This
// browser" (or the one they were connected through), each connected account (e.g. Migma) brings
// its own relay, and when they are the same relay they share one socket.

import { RelayClient } from './relay-client.js';
import { agentRelay, getAccounts, getAgents, getSettings } from './store.js';

function rolesKey(roles) {
  return JSON.stringify({ tokens: roles.tokens, connectionId: roles.account?.connectionId ?? null });
}

export class Connections {
  constructor({ onCall, onAccount }) {
    this.onCall = onCall;
    this.onAccount = onAccount;
    this.clients = new Map();
    this.queue = Promise.resolve();
  }

  /** Brings the open connections in line with settings and accounts. Calls run one at a time. */
  sync() {
    this.queue = this.queue.then(() => this.apply()).catch(() => undefined);
    return this.queue;
  }

  async apply() {
    const [settings, accounts, agents] = await Promise.all([getSettings(), getAccounts(), getAgents()]);
    const desired = new Map();
    // The relay in settings is always open (new agents go there); agents on other relays (e.g. one
    // whose sign-in page connected them) keep theirs open while they exist.
    if (settings.relayUrl) desired.set(settings.relayUrl, { tokens: true, account: null });
    for (const agent of agents) {
      const relayUrl = agentRelay(agent, settings);
      if (relayUrl && !desired.has(relayUrl)) desired.set(relayUrl, { tokens: true, account: null });
    }
    for (const account of accounts) {
      const roles = desired.get(account.relayUrl) ?? { tokens: false, account: null };
      roles.account = account;
      desired.set(account.relayUrl, roles);
    }

    for (const [relayUrl, client] of this.clients) {
      if (desired.has(relayUrl)) continue;
      this.clients.delete(relayUrl);
      await client.stop();
    }
    for (const [relayUrl, roles] of desired) {
      const client = this.clients.get(relayUrl);
      if (!client) {
        const created = new RelayClient({ relayUrl, roles, onCall: this.onCall, onAccount: this.onAccount });
        this.clients.set(relayUrl, created);
        created.connect();
      } else if (rolesKey(client.roles) !== rolesKey(roles)) {
        await client.setRoles(roles);
      } else {
        client.roles = roles; // e.g. access changed: no new hello needed
      }
    }
  }

  async syncAgents() {
    await Promise.all([...this.clients.values()].map((client) => client.syncAgents()));
  }

  broadcast(message) {
    for (const client of this.clients.values()) client.send(message);
  }

  ensureConnected() {
    if (!this.clients.size) this.sync();
    for (const client of this.clients.values()) client.ensureConnected();
  }

  async restartAll() {
    await this.sync();
    await Promise.all([...this.clients.values()].map((client) => client.restart()));
  }
}
