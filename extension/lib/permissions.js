// Per-site access gate, modelled on ChatGPT's browser extension: the first time an agent touches a
// site, the user picks Allow for now (10 min, this agent), Always allow this site, Allow all sites,
// Decline, or Block. Listing tab titles needs no prompt; reading or acting on a page does.

import { getSession, getSettings, getSites, saveSites, setSession, siteOf, updateSettings } from './store.js';

export class ToolError extends Error {}

const TEMPORARY_GRANT_MS = 10 * 60 * 1000;
const PROMPT_TIMEOUT_MS = 90 * 1000;
const RESTRICTED_URL = [
  /^chrome:/i,
  /^chrome-extension:/i,
  /^chrome-search:/i,
  /^chrome-untrusted:/i,
  /^devtools:/i,
  /^edge:/i,
  /^about:/i,
  /^view-source:/i,
  /^https:\/\/chromewebstore\.google\.com\//i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
];

/** Pages Chrome never lets an extension script. */
export function isRestrictedUrl(url) {
  return !url || RESTRICTED_URL.some((pattern) => pattern.test(url));
}

export async function isBlockedSite(url) {
  const { blocked } = await getSites();
  return blocked.includes(siteOf(url));
}

const waiting = new Map(); // promptId -> { resolve, timer, windowId }
const inFlight = new Map(); // `${agentId}|${site}` -> Promise<decision>

export async function ensureSiteAccess(agent, url) {
  if (isRestrictedUrl(url)) {
    throw new ToolError(`Chrome does not let extensions read or use this page (${url || 'blank tab'}).`);
  }
  const site = siteOf(url);
  const [settings, sites] = await Promise.all([getSettings(), getSites()]);
  if (sites.blocked.includes(site)) throw new ToolError(`The user blocked ${site} for agents. Do not retry.`);
  if (settings.allowAllSites || sites.allowed.includes(site)) return;

  const key = `${agent.id}|${site}`;
  const grants = await getSession('grants', {});
  if ((grants[key] ?? 0) > Date.now()) return;

  if (!inFlight.has(key)) {
    inFlight.set(key, askUser(agent, site, url).finally(() => inFlight.delete(key)));
  }
  const decision = await inFlight.get(key);
  await applyDecision(decision, key, site);
}

async function applyDecision(decision, key, site) {
  switch (decision) {
    case 'once': {
      const grants = await getSession('grants', {});
      grants[key] = Date.now() + TEMPORARY_GRANT_MS;
      await setSession('grants', grants);
      return;
    }
    case 'site': {
      const sites = await getSites();
      if (!sites.allowed.includes(site)) sites.allowed.push(site);
      await saveSites(sites);
      return;
    }
    case 'all':
      await updateSettings({ allowAllSites: true });
      return;
    case 'block': {
      const sites = await getSites();
      if (!sites.blocked.includes(site)) sites.blocked.push(site);
      sites.allowed = sites.allowed.filter((entry) => entry !== site);
      await saveSites(sites);
      throw new ToolError(`The user blocked ${site} for agents. Do not retry.`);
    }
    case 'timeout':
      throw new ToolError(`The user did not answer the request to use ${site}. Ask them before trying again.`);
    default:
      throw new ToolError(`The user declined access to ${site}. Do not retry unless they ask you to.`);
  }
}

async function askUser(agent, site, url) {
  const id = crypto.randomUUID();
  const prompts = await getSession('prompts', []);
  prompts.push({ id, agentLabel: agent.label, access: agent.access, site, url, createdAt: Date.now() });
  await setSession('prompts', prompts);
  await updateBadge();

  return new Promise((resolve) => {
    const timer = setTimeout(() => settlePrompt(id, 'timeout'), PROMPT_TIMEOUT_MS);
    waiting.set(id, { resolve, timer, windowId: null });
    chrome.windows
      .create({
        url: chrome.runtime.getURL(`prompt/prompt.html?id=${encodeURIComponent(id)}`),
        type: 'popup',
        width: 420,
        height: 440,
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

/** Called from the prompt window or side panel. Unknown ids (already settled) are ignored. */
export async function settlePrompt(id, decision) {
  const entry = waiting.get(id);
  waiting.delete(id);
  const prompts = await getSession('prompts', []);
  await setSession(
    'prompts',
    prompts.filter((prompt) => prompt.id !== id)
  );
  await updateBadge();
  if (!entry) return;
  clearTimeout(entry.timer);
  if (entry.windowId) chrome.windows.remove(entry.windowId).catch(() => undefined);
  entry.resolve(decision);
}

/** Closing the prompt window without answering declines. */
export function handleWindowRemoved(windowId) {
  for (const [id, entry] of waiting) {
    if (entry.windowId === windowId) {
      entry.windowId = null;
      settlePrompt(id, 'decline');
    }
  }
}

/** Prompts are in-memory; after a service-worker restart, stale ones are dropped. */
export async function clearOrphanPrompts() {
  const prompts = await getSession('prompts', []);
  const live = prompts.filter((prompt) => waiting.has(prompt.id));
  if (live.length !== prompts.length) await setSession('prompts', live);
  await updateBadge();
}

async function updateBadge() {
  const prompts = await getSession('prompts', []);
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setBadgeText({ text: prompts.length ? String(prompts.length) : '' });
}
