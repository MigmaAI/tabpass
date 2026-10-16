import { randomBytes } from 'node:crypto';

import { WebSocket } from 'ws';

import { PROTOCOL_VERSION, type AccountCredential, type AgentAccess, type CallMessage, type RelayMessage } from '../src/protocol.js';
import { browserIdFromKey, hashSecret } from '../src/tokens.js';

export interface FakeAgent {
  token: string;
  tokenHash: string;
  label: string;
  access: AgentAccess;
}

export function makeAgent(browserKey: string, label: string, access: AgentAccess): FakeAgent {
  const secret = randomBytes(32).toString('base64url');
  return { token: `tp_${browserIdFromKey(browserKey)}.${secret}`, tokenHash: hashSecret(secret), label, access };
}

/** Stands in for the Chrome extension's service worker. */
export class FakeExtension {
  readonly browserKey = randomBytes(32).toString('base64url');
  readonly calls: CallMessage[] = [];
  readonly messages: RelayMessage[] = [];
  socket!: WebSocket;
  onCall: (call: CallMessage) => void = (call) => this.reply(call.id, `ok:${call.tool}`);

  async connect(
    url: string,
    agents: FakeAgent[],
    options: { protocol?: number; account?: AccountCredential; browserName?: string } = {}
  ): Promise<RelayMessage> {
    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
    const first = new Promise<RelayMessage>((resolve) => {
      this.socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as RelayMessage;
        this.messages.push(message);
        if (message.type === 'call') {
          this.calls.push(message);
          this.onCall(message);
        }
        resolve(message);
      });
    });
    this.send({
      type: 'hello',
      protocol: options.protocol ?? PROTOCOL_VERSION,
      browserKey: this.browserKey,
      extensionVersion: 'test',
      browserName: options.browserName ?? 'Test Chrome',
      agents: this.grants(agents),
      ...(options.account ? { account: options.account } : {}),
    });
    return first;
  }

  get browserId(): string {
    return browserIdFromKey(this.browserKey);
  }

  /** Resolves with the next message of this type (or one already received after `since`). */
  async next<T extends RelayMessage['type']>(type: T, since = 0, timeoutMs = 3000): Promise<Extract<RelayMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.slice(since).find((message) => message.type === type);
      if (found) return found as Extract<RelayMessage, { type: T }>;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`No ${type} message within ${timeoutMs}ms`);
  }

  grants(agents: FakeAgent[]): Array<{ tokenHash: string; label: string; access: AgentAccess }> {
    return agents.map(({ tokenHash, label, access }) => ({ tokenHash, label, access }));
  }

  reply(id: string, text: string, isError = false): void {
    this.send({ type: 'result', id, result: { content: [{ type: 'text', text }], isError } });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) return resolve();
      this.socket.once('close', () => resolve());
      this.socket.close();
    });
  }
}

