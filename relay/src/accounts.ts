import type { AccountCredential } from './protocol.js';

/**
 * Account mode: a provider (Migma, or anyone running a relay) pairs a browser with one *person*
 * in its own system. The provider issues a connection id + secret to the extension; the relay
 * asks the provider to verify it on every hello and every `reverifyMs`.
 *
 * `accountId` must identify a person, never a team: a browser holds one person's sessions, so a
 * teammate, an org admin or an org-wide key must never be able to reach it.
 */
export interface BrowserAccount {
  accountId: string;
  connectionId: string;
  /** Display name of the person, shown back to the extension. */
  name?: string;
}

/** The browser presenting a credential. Providers should pin a connection to the first browserId
 * that uses it, so a leaked secret cannot be replayed from another browser. */
export interface PresentingBrowser {
  browserId: string;
  name: string;
}

export interface AccountVerifier {
  /**
   * Resolve a credential. Return null when the provider does not know it (revoked or deleted);
   * throw when the provider cannot be reached, so the browser keeps its credential and retries.
   */
  verify(credential: AccountCredential, browser: PresentingBrowser): Promise<BrowserAccount | null>;
}

export interface HttpAccountVerifierOptions {
  /** POST endpoint on the provider, e.g. https://api.migma.ai/internal/tabpass/verify */
  url: string;
  /** Shared secret the relay sends as a Bearer token so the provider knows the caller. */
  secret: string;
  timeoutMs?: number;
}

/**
 * Verifies credentials against the provider over HTTP.
 * Request:  POST { connectionId, secret, browserId, browserName }
 * Response: 200 { accountId, name? } | 404/410 (unknown or revoked) | anything else (unavailable)
 */
export function httpAccountVerifier(options: HttpAccountVerifierOptions): AccountVerifier {
  return {
    async verify(credential: AccountCredential, browser: PresentingBrowser): Promise<BrowserAccount | null> {
      const response = await fetch(options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.secret}` },
        body: JSON.stringify({ ...credential, browserId: browser.browserId, browserName: browser.name }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      });
      // Only "not found" means revoked. A 401/403 means the relay's own secret is wrong; treating that
      // as revoked would wipe every browser's connection over one config mistake.
      if (response.status === 404 || response.status === 410) return null;
      if (!response.ok) throw new Error(`Account provider answered ${response.status}`);
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null) throw new Error('Account provider sent no account');
      const { accountId, name } = body as { accountId?: unknown; name?: unknown };
      if (typeof accountId !== 'string' || !accountId) throw new Error('Account provider sent no accountId');
      return {
        accountId,
        connectionId: credential.connectionId,
        ...(typeof name === 'string' ? { name: name.slice(0, 120) } : {}),
      };
    },
  };
}
