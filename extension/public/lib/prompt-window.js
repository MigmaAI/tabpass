// Every "ask the person" window in one place: site access, connecting an account, and connecting
// an AI tool. Each kind keeps its pending requests in session storage (so the side panel can show
// them too) and opens prompt.html in a small popup window.

import { getSession, setSession } from './store.js';

const KINDS = {
  site: { key: 'prompts', query: 'id', height: 460 },
  account: { key: 'connectPrompts', query: 'connect', height: 600 },
  agent: { key: 'agentPrompts', query: 'agent', height: 600 },
};

const waiting = new Map(); // id -> { kind, resolve, timer, windowId, cancelDecision }

/**
 * Opens the window and resolves with the person's decision, `timeoutDecision` if they do not
 * answer in time, or `cancelDecision` if they close the window.
 */
export async function ask(kind, data, { timeoutMs, timeoutDecision, cancelDecision }) {
  const config = KINDS[kind];
  const id = crypto.randomUUID();
  const list = await getSession(config.key, []);
  list.push({ id, ...data, createdAt: Date.now() });
  await setSession(config.key, list);
  await updateBadge();

  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(id, timeoutDecision), timeoutMs);
    waiting.set(id, { kind, resolve, timer, windowId: null, cancelDecision });
    chrome.windows
      .create({
        url: chrome.runtime.getURL(`prompt.html?${config.query}=${encodeURIComponent(id)}`),
        type: 'popup',
        width: 420,
        height: config.height,
        focused: true,
      })
      .then((win) => {
        const entry = waiting.get(id);
        if (entry) entry.windowId = win.id ?? null;
        else if (win.id) chrome.windows.remove(win.id).catch(() => undefined);
      })
      .catch(() => undefined); // The side panel still lists the request.
  });
}

/** Answers a request. Unknown ids (already settled, or from before a restart) are just cleared. */
export async function settle(id, decision) {
  const entry = waiting.get(id);
  waiting.delete(id);
  for (const { key } of Object.values(KINDS)) {
    const list = await getSession(key, []);
    if (list.some((item) => item.id === id)) await setSession(key, list.filter((item) => item.id !== id));
  }
  await updateBadge();
  if (!entry) return;
  clearTimeout(entry.timer);
  if (entry.windowId) chrome.windows.remove(entry.windowId).catch(() => undefined);
  entry.resolve(decision);
}

export async function pending(kind) {
  return getSession(KINDS[kind].key, []);
}

/** Closing a prompt window answers it with that kind's cancel decision. */
export function handleWindowRemoved(windowId) {
  for (const [id, entry] of waiting) {
    if (entry.windowId === windowId) {
      entry.windowId = null;
      settle(id, entry.cancelDecision);
    }
  }
}

/** Requests live in memory; after a service-worker restart, stale ones are dropped. */
export async function clearOrphans() {
  for (const { key } of Object.values(KINDS)) {
    const list = await getSession(key, []);
    const live = list.filter((item) => waiting.has(item.id));
    if (live.length !== list.length) await setSession(key, live);
  }
  await updateBadge();
}

async function updateBadge() {
  let count = 0;
  for (const { key } of Object.values(KINDS)) count += (await getSession(key, [])).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#0a84ff' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}
