// Bridges the service worker to content/page-agent.js inside a tab.

import { ToolError } from './permissions.js';

const PAGE_AGENT_FILE = 'content/page-agent.js';

function invoke(tabId, method, args) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (name, input) => globalThis.__tabpassAgent?.call(name, input) ?? { missing: true },
    args: [method, args],
  });
}

/** Runs one page-agent method in the tab's top frame, injecting the agent on first use. */
export async function callPage(tabId, method, args = {}) {
  let frames;
  try {
    frames = await invoke(tabId, method, args);
    if (frames[0]?.result?.missing) {
      await chrome.scripting.executeScript({ target: { tabId }, files: [PAGE_AGENT_FILE] });
      frames = await invoke(tabId, method, args);
    }
  } catch (error) {
    throw new ToolError(`Could not reach the page: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = frames[0]?.result;
  if (!result || result.missing) throw new ToolError('The page did not respond. It may still be loading.');
  if (result.error) throw new ToolError(result.error);
  return result.value;
}

/**
 * Resolves when the tab has finished loading. With `navigating`, an initial "complete" status is
 * ignored for a moment, because right after tabs.update the old page still reports complete.
 */
export function waitForLoad(tabId, { timeoutMs = 15000, navigating = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let sawLoading = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(status);
    };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && (sawLoading || !navigating)) finish('complete');
    };
    const onRemoved = (id) => {
      if (id === tabId) finish('closed');
    };
    const checkNow = () =>
      chrome.tabs
        .get(tabId)
        .then((tab) => {
          if (tab.status === 'complete') finish('complete');
        })
        .catch(() => finish('closed'));

    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    const graceTimer = setTimeout(() => {
      if (!sawLoading) checkNow();
    }, navigating ? 1000 : 0);
  });
}
