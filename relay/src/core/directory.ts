import type { AgentGrant, ToolResult } from './protocol.js';
import type { ParsedAgentToken } from './tokens.js';

/**
 * Where browsers live. The Node relay keeps them in memory (one process); the Cloudflare relay
 * keeps each browser in its own Durable Object and each person's list in another. The HTTP app
 * (MCP, OAuth, internal API) only talks to this interface, so both hosts share it.
 */
export interface BrowserDirectory {
  lookupAgent(token: ParsedAgentToken): Promise<AgentLookup>;
  callAgent(token: ParsedAgentToken, tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  accountBrowsers(accountId: string): Promise<AccountBrowser[]>;
  callAccount(accountId: string, tool: string, args: Record<string, unknown>, options?: AccountCallOptions): Promise<ToolResult>;
  /** Cuts a provider connection off now. Returns how many live browsers it reached. */
  revokeConnection(accountId: string, connectionId: string): Promise<number>;
  /** OAuth: marks an authorization code used. False when it was already used (replay). */
  consumeCode(browserId: string, codeId: string, expiresAt: number): Promise<boolean>;
  stats(): Promise<DirectoryStats>;
}

export type AgentLookup = { status: 'ok'; agent: AgentGrant; browser?: { id: string; name: string } } | { status: 'offline' } | { status: 'invalid' };

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

export interface DirectoryStats {
  browsers?: number;
  accounts?: number;
  pendingCalls?: number;
}

export const MESSAGES = {
  offline: 'The browser is offline. Open Chrome with the Tabpass extension, then try again.',
  removed: 'This agent was removed in the browser. Ask the user to connect it again.',
  noAccountBrowser: 'No browser is connected for this person right now. Ask them to open Chrome with Tabpass and connect it.',
  disconnected: 'The browser disconnected before answering.',
  revoked: 'The connection to this browser was removed.',
};

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Old extensions ignore the new read arguments. Reject those requests instead of returning
 * a different document or repeating its first page under the requested format/offset. */
export function readPageCompatibilityError(extensionVersion: string, tool: string, args: Record<string, unknown>): ToolResult | null {
  if (tool !== 'read_page') return null;
  const advanced = (args.format !== undefined && args.format !== 'markdown')
    || (typeof args.offset === 'number' && args.offset > 0)
    || (typeof args.selector === 'string' && args.selector.length > 0);
  if (!advanced) return null;
  // Chrome manifest versions have three or four numeric components. Compare numbers, not strings
  // (0.10.0 is newer than 0.4.0). Unknown versions keep basic reads but cannot promise new formats.
  const version = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(extensionVersion);
  if (version && (Number(version[1]) > 0 || Number(version[2]) >= 4)) return null;
  return errorResult('Update Tabpass to 0.4.0 or later in this browser to use read_page format, selector or offset. Basic reads still work.');
}

/** Picks one of a person's browsers: the named one, or the one they used last. */
export function chooseBrowser(browsers: AccountBrowser[], wanted?: string): { browser: AccountBrowser } | { error: string } {
  const sorted = [...browsers].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  if (!sorted.length) return { error: MESSAGES.noAccountBrowser };
  if (!wanted) return { browser: sorted[0]! };
  const exactId = sorted.find((browser) => browser.browserId === wanted);
  if (exactId) return { browser: exactId };
  const name = wanted.trim().toLowerCase();
  const matches = sorted.filter((browser) => browser.name.toLowerCase() === name);
  if (matches.length === 1) return { browser: matches[0]! };
  if (matches.length > 1) return { error: `Several connected browsers are called "${wanted}". Choose a browser ID from list_browsers: ${matches.map((browser) => browser.browserId).join(', ')}.` };
  return { error: `No connected browser called "${wanted}". Connected: ${sorted.map((browser) => browser.name).join(', ')}.` };
}

interface PendingCall {
  owner: string;
  resolve: (result: ToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Correlates tool calls sent over a socket with the results that come back. Never rejects. */
export class PendingCalls {
  private readonly calls = new Map<string, PendingCall>();

  constructor(private readonly timeoutMs: number) {}

  get size(): number {
    return this.calls.size;
  }

  start(owner: string, send: (id: string) => void): Promise<ToolResult> {
    const id = crypto.randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        resolve(errorResult(`The browser did not answer within ${Math.round(this.timeoutMs / 1000)}s.`));
      }, this.timeoutMs);
      this.calls.set(id, { owner, resolve, timer });
      send(id);
    });
  }

  /** A browser may only answer calls that were sent to it; pass its id as owner. */
  settle(id: string, owner: string | null, result: ToolResult): boolean {
    const call = this.calls.get(id);
    if (!call || (owner !== null && call.owner !== owner)) return false;
    clearTimeout(call.timer);
    this.calls.delete(id);
    call.resolve(result);
    return true;
  }

  failOwner(owner: string, message: string): void {
    for (const [id, call] of this.calls) {
      if (call.owner === owner) this.settle(id, owner, errorResult(message));
    }
  }

  failAll(message: string): void {
    for (const id of [...this.calls.keys()]) this.settle(id, null, errorResult(message));
  }
}
