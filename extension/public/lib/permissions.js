// Per-site access gate, modelled on ChatGPT's browser extension: the first time an agent touches a
// site, the user picks Allow for now (10 min, this agent), Always allow this site, Allow all sites,
// Decline, or Block. Listing tab titles needs no prompt; reading or acting on a page does.

import { ask } from './prompt-window.js';
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

function askUser(agent, site, url) {
  return ask(
    'site',
    { agentLabel: agent.label, access: agent.access, site, url },
    { timeoutMs: PROMPT_TIMEOUT_MS, timeoutDecision: 'timeout', cancelDecision: 'decline' }
  );
}
