import type { AccountObject } from './account-object.js';
import type { BrowserObject } from './browser-object.js';

/** Bindings and settings from wrangler.toml and `wrangler secret put`. */
export interface Env {
  BROWSERS: DurableObjectNamespace<BrowserObject>;
  ACCOUNTS: DurableObjectNamespace<AccountObject>;
  /** e.g. https://tabs.migma.ai */
  PUBLIC_URL: string;
  /** Chrome Web Store page, for the OAuth page's "Install Tabpass". */
  INSTALL_URL?: string;
  /** Secret: turns on OAuth. At least 32 characters; keep it stable. */
  RELAY_SECRET?: string;
  /** Secret: lets an account provider call /internal. */
  INTERNAL_SECRET?: string;
  /** Account mode: where browser connections are verified, and the secret sent there. */
  ACCOUNTS_VERIFY_URL?: string;
  ACCOUNTS_VERIFY_SECRET?: string;
}
