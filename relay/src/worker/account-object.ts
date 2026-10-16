import { DurableObject } from 'cloudflare:workers';

import type { AccountBrowser } from '../core/directory.js';

import type { Env } from './env.js';

/**
 * One per person (named by their account id at the provider): which of their browsers are
 * connected right now. Browser objects register and unregister themselves here.
 */
export class AccountObject extends DurableObject<Env> {
  private browsers(): Promise<Map<string, AccountBrowser>> {
    return this.ctx.storage.list<AccountBrowser>({ prefix: 'browser:' });
  }

  async register(browser: AccountBrowser): Promise<void> {
    await this.ctx.storage.put(`browser:${browser.browserId}`, browser);
  }

  async unregister(browserId: string): Promise<void> {
    await this.ctx.storage.delete(`browser:${browserId}`);
  }

  async touch(browserId: string, lastActiveAt: number): Promise<void> {
    const key = `browser:${browserId}`;
    const browser = await this.ctx.storage.get<AccountBrowser>(key);
    if (browser) await this.ctx.storage.put(key, { ...browser, lastActiveAt });
  }

  async list(): Promise<AccountBrowser[]> {
    return [...(await this.browsers()).values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }
}
