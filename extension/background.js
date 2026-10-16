// Service worker: keeps the relay connection, runs tool calls, and answers the side panel and the
// site-access prompt window.

import { createAgentToken } from './lib/crypto.js';
import { clearOrphanPrompts, handleWindowRemoved, settlePrompt } from './lib/permissions.js';
import { RelayClient } from './lib/relay-client.js';
import {
  clearActivity,
  findAgentByHash,
  getAgents,
  getSession,
  getSettings,
  getSites,
  nextAgentColor,
  saveAgents,
  saveSites,
  siteOf,
  updateSettings,
} from './lib/store.js';
import { runTool } from './lib/tools.js';

const KEEPALIVE_ALARM = 'relay-keepalive';
const DECISIONS = new Set(['once', 'site', 'all', 'decline', 'block']);

const relay = new RelayClient({
  onCall: async (message) => {
    const agent = await findAgentByHash(message.tokenHash);
    if (!agent) return { content: [{ type: 'text', text: 'This agent was removed from Migma Tabs.' }], isError: true };
    return runTool(agent, message.tool, message.args ?? {});
  },
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) relay.ensureConnected();
});
chrome.windows.onRemoved.addListener(handleWindowRemoved);
chrome.runtime.onStartup.addListener(() => relay.ensureConnected());
chrome.runtime.onInstalled.addListener(() => relay.ensureConnected());

clearOrphanPrompts();
relay.connect();

function cleanSite(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';
  return siteOf(input.includes('://') ? input : `https://${input}`);
}

async function state() {
  const [settings, agents, sites, status, prompts, { activity }] = await Promise.all([
    getSettings(),
    getAgents(),
    getSites(),
    getSession('status', { state: 'connecting' }),
    getSession('prompts', []),
    chrome.storage.local.get('activity'),
  ]);
  const { browserKey: _secret, ...publicSettings } = settings;
  return { settings: publicSettings, agents, sites, status, prompts, activity: activity ?? [] };
}

async function handleUiMessage(message) {
  switch (message?.type) {
    case 'getState':
      return state();

    case 'addAgent': {
      const label = String(message.label ?? '').trim().slice(0, 40);
      if (!label) throw new Error('Give the agent a name.');
      const access = message.access === 'control' ? 'control' : 'read';
      const agents = await getAgents();
      const { browserKey } = await getSettings();
      const { token, tokenHash } = await createAgentToken(browserKey);
      const agent = {
        id: crypto.randomUUID(),
        label,
        access,
        token,
        tokenHash,
        color: nextAgentColor(agents),
        createdAt: Date.now(),
        lastUsedAt: null,
      };
      await saveAgents([...agents, agent]);
      await relay.syncAgents();
      return agent;
    }

    case 'removeAgent': {
      await saveAgents((await getAgents()).filter((agent) => agent.id !== message.id));
      await relay.syncAgents();
      return state();
    }

    case 'setAgentAccess': {
      const agents = await getAgents();
      const agent = agents.find((candidate) => candidate.id === message.id);
      if (agent) agent.access = message.access === 'control' ? 'control' : 'read';
      await saveAgents(agents);
      await relay.syncAgents();
      return state();
    }

    case 'setRelayUrl': {
      const relayUrl = String(message.relayUrl ?? '').trim();
      if (!/^wss?:\/\/[^\s]+$/i.test(relayUrl)) throw new Error('Use a ws:// or wss:// address.');
      await updateSettings({ relayUrl });
      await relay.restart();
      return state();
    }

    case 'reconnect':
      await relay.restart();
      return state();

    case 'setPaused':
      await updateSettings({ paused: Boolean(message.paused) });
      return state();

    case 'setAllowAllSites':
      await updateSettings({ allowAllSites: Boolean(message.value) });
      return state();

    case 'addSite': {
      const site = cleanSite(message.site);
      if (!site) throw new Error('Enter a site like example.com.');
      const sites = await getSites();
      const list = message.list === 'blocked' ? 'blocked' : 'allowed';
      const other = list === 'blocked' ? 'allowed' : 'blocked';
      if (!sites[list].includes(site)) sites[list].push(site);
      sites[other] = sites[other].filter((entry) => entry !== site);
      await saveSites(sites);
      return state();
    }

    case 'removeSite': {
      const sites = await getSites();
      const list = message.list === 'blocked' ? 'blocked' : 'allowed';
      sites[list] = sites[list].filter((entry) => entry !== message.site);
      await saveSites(sites);
      return state();
    }

    case 'promptDecision':
      if (!DECISIONS.has(message.decision)) throw new Error('Unknown decision.');
      await settlePrompt(message.id, message.decision);
      return state();

    case 'clearActivity':
      await clearActivity();
      return state();

    default:
      throw new Error('Unknown request.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pages (side panel, prompt window) may change settings.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  handleUiMessage(message).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
  );
  return true;
});
