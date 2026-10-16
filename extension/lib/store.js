// Persistent state lives in chrome.storage.local; per-browser-session state (temporary site grants,
// agent tab groups, connection status) lives in chrome.storage.session so it survives the service
// worker being suspended but not a browser restart.

import { randomKey } from './crypto.js';

export const DEFAULT_RELAY_URL = 'ws://localhost:8787/extension';
const MAX_ACTIVITY = 60;
const AGENT_COLORS = ['blue', 'cyan', 'green', 'pink', 'yellow', 'red', 'grey'];

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings?.browserKey) return { relayUrl: DEFAULT_RELAY_URL, paused: false, allowAllSites: false, ...settings };
  const created = { relayUrl: DEFAULT_RELAY_URL, browserKey: randomKey(), paused: false, allowAllSites: false };
  await chrome.storage.local.set({ settings: created });
  return created;
}

export async function updateSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

export async function getAgents() {
  const { agents } = await chrome.storage.local.get('agents');
  return Array.isArray(agents) ? agents : [];
}

export async function saveAgents(agents) {
  await chrome.storage.local.set({ agents });
}

export function nextAgentColor(agents) {
  return AGENT_COLORS[agents.length % AGENT_COLORS.length];
}

export async function findAgentByHash(tokenHash) {
  return (await getAgents()).find((agent) => agent.tokenHash === tokenHash) ?? null;
}

export async function touchAgent(agentId) {
  const agents = await getAgents();
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) return;
  agent.lastUsedAt = Date.now();
  await saveAgents(agents);
}

export async function getSites() {
  const { sites } = await chrome.storage.local.get('sites');
  return { allowed: sites?.allowed ?? [], blocked: sites?.blocked ?? [] };
}

export async function saveSites(sites) {
  await chrome.storage.local.set({ sites });
}

export async function addActivity(entry) {
  const { activity } = await chrome.storage.local.get('activity');
  const list = Array.isArray(activity) ? activity : [];
  list.unshift({ at: Date.now(), ...entry });
  await chrome.storage.local.set({ activity: list.slice(0, MAX_ACTIVITY) });
}

export async function clearActivity() {
  await chrome.storage.local.set({ activity: [] });
}

export async function getSession(key, fallback) {
  const result = await chrome.storage.session.get(key);
  return result[key] ?? fallback;
}

export async function setSession(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

/** `www.example.com` and `example.com` count as one site. */
export function siteOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return 'file://';
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
