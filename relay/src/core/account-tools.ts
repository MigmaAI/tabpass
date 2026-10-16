import { errorResult, MESSAGES, type AccountCallOptions, type BrowserDirectory } from './directory.js';
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
export async function runAccountTool(
  directory: BrowserDirectory,
  accountId: string,
  tool: string,
  args: Record<string, unknown>,
  options: Pick<AccountCallOptions, 'via'> = {}
): Promise<ToolResult> {
  if (tool === 'list_browsers') {
    const browsers = await directory.accountBrowsers(accountId);
    if (!browsers.length) return errorResult(MESSAGES.noAccountBrowser);
    const lines = browsers
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map((browser, index) => `- ${browser.name}${index === 0 ? ' (default)' : ''}: last used ${ago(browser.lastActiveAt)}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
  const { browser, ...rest } = args;
  return directory.callAccount(accountId, tool, rest, { ...options, ...(typeof browser === 'string' ? { browser } : {}) });
}
