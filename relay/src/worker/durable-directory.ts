import {
  chooseBrowser,
  errorResult,
  type AccountBrowser,
  type AccountCallOptions,
  type AgentLookup,
  type BrowserDirectory,
  type DirectoryStats,
} from '../core/directory.js';
import type { ToolResult } from '../core/protocol.js';
import type { ParsedAgentToken } from '../core/tokens.js';

import type { Env } from './env.js';

/** The Cloudflare relay's directory: one Durable Object per browser, one per person. */
export class DurableDirectory implements BrowserDirectory {
  constructor(private readonly env: Env) {}

  private browser(browserId: string): DurableObjectStub<import('./browser-object.js').BrowserObject> {
    return this.env.BROWSERS.get(this.env.BROWSERS.idFromName(browserId));
  }

  private person(accountId: string): DurableObjectStub<import('./account-object.js').AccountObject> {
    return this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(accountId));
  }

  lookupAgent(token: ParsedAgentToken): Promise<AgentLookup> {
    return this.browser(token.browserId).lookupAgent(token.tokenHash);
  }

  callAgent(token: ParsedAgentToken, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.browser(token.browserId).callAgent(token.tokenHash, tool, args);
  }

  accountBrowsers(accountId: string): Promise<AccountBrowser[]> {
    return this.person(accountId).list();
  }

  async callAccount(accountId: string, tool: string, args: Record<string, unknown>, options: AccountCallOptions = {}): Promise<ToolResult> {
    let browsers = await this.accountBrowsers(accountId);
    // A browser that vanished without saying goodbye is dropped and the next one is tried.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const choice = chooseBrowser(browsers, options.browser);
      if ('error' in choice) return errorResult(choice.error);
      const result = await this.browser(choice.browser.browserId).callAccount(accountId, tool, args, options.via);
      if (result) return result;
      await this.person(accountId).unregister(choice.browser.browserId);
      browsers = browsers.filter((browser) => browser.browserId !== choice.browser.browserId);
    }
    return errorResult('That browser just disconnected. Try again.');
  }

  async revokeConnection(accountId: string, connectionId: string): Promise<number> {
    const browsers = await this.accountBrowsers(accountId);
    const counts = await Promise.all(browsers.map((browser) => this.browser(browser.browserId).revoke(accountId, connectionId)));
    return counts.reduce((sum, count) => sum + count, 0);
  }

  consumeCode(browserId: string, codeId: string, expiresAt: number): Promise<boolean> {
    return this.browser(browserId).consumeCode(codeId, expiresAt);
  }

  async stats(): Promise<DirectoryStats> {
    return {}; // Counts live in many objects; Cloudflare's dashboard has them.
  }
}
