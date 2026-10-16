import type { AccountCallOptions, BrowserHub } from './browser-hub.js';
import { errorResult } from './browser-hub.js';
import type { ToolResult } from './protocol.js';

function ago(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/**
 * Runs an account-mode tool for a person: `list_browsers` is answered here, everything else goes
 * to their chosen (or most recently used) browser. `args.browser` is consumed, not forwarded.
 */
export function runAccountTool(
  hub: BrowserHub,
  accountId: string,
  tool: string,
  args: Record<string, unknown>,
  options: Pick<AccountCallOptions, 'via'> = {}
): Promise<ToolResult> {
  if (tool === 'list_browsers') {
    const browsers = hub.accountBrowsers(accountId);
    if (!browsers.length) return Promise.resolve(errorResult('No browser is connected for this person right now.'));
    const lines = browsers.map(
      (browser, index) => `- ${browser.name}${index === 0 ? ' (default)' : ''}: last used ${ago(browser.lastActiveAt)}`
    );
    return Promise.resolve({ content: [{ type: 'text', text: lines.join('\n') }] });
  }
  const { browser, ...rest } = args;
  return hub.callAccount(accountId, tool, rest, {
    ...options,
    ...(typeof browser === 'string' ? { browser } : {}),
  });
}
