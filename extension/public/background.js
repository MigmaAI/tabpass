// Service worker: keeps the relay connections, runs tool calls, and answers the side panel, the
// prompt windows, and account providers' websites (one-click connect).

import {
  cancelConnect,
  clearOrphanConnectPrompts,
  handleConnectWindowRemoved,
  handleExternalMessage,
  settleConnectPrompt,
  startConnect,
} from './lib/account-connect.js';
import { Connections } from './lib/connections.js';
import { createAgentToken } from './lib/crypto.js';
import { clearOrphanPrompts, handleWindowRemoved, settlePrompt } from './lib/permissions.js';
import { PROVIDERS } from './lib/providers.js';
import { statusKey } from './lib/relay-client.js';
import {
  clearActivity,
  findAgentByHash,
  getAccounts,
  getAgents,
  getSession,
  getSettings,
  getSites,
  nextAgentColor,
  saveAccounts,
  saveAgents,
  saveSites,
  setNotice,
  setSession,
  siteOf,
  updateSettings,
} from './lib/store.js';
import { runTool } from './lib/tools.js';

const KEEPALIVE_ALARM = 'relay-keepalive';
const DECISIONS = new Set(['once', 'site', 'all', 'decline', 'block']);
const PRESENCE_THROTTLE_MS = 30_000;

function refusal(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

/** The agent identity an account call runs as: one per provider ("Migma"), with the access the person chose. */
function accountAgent(account, via) {
  return {
    id: `account:${account.provider}`,
    label: account.providerName,
    via: via ?? null,
    access: account.access,
    color: 'grey',
  };
}

async function onCall(message, client) {
  if (message.account) {
    // Only the relay that holds this account may act as it, and only with the access stored now.
    const connectionId = client.roles.account?.connectionId;
    const account = (await getAccounts()).find((candidate) => candidate.connectionId === connectionId);
    if (!account) return refusal('This browser is no longer connected to that account.');
    return runTool(accountAgent(account, message.account.via), message.tool, message.args ?? {});
  }
  // Token agents live only on the relay set under "This browser"; another relay cannot reach them.
  if (!client.roles.tokens || typeof message.tokenHash !== 'string') return refusal('Unknown agent.');
  const agent = await findAgentByHash(message.tokenHash);
  if (!agent) return refusal('This agent was removed from Tabpass.');
  return runTool(agent, message.tool, message.args ?? {});
}

async function setAccountStatus(provider, status) {
  const statuses = await getSession('accountStatus', {});
  statuses[provider] = { ...status, at: Date.now() };
  await setSession('accountStatus', statuses);
}

async function onAccount(account, { status, name }) {
  switch (status) {
    case 'ok':
      await setAccountStatus(account.provider, { state: 'connected', name: name ?? null });
      break;
    case 'invalid': {
      // The provider no longer knows this connection (removed in its settings, account deleted).
      const accounts = await getAccounts();
      if (!accounts.some((candidate) => candidate.connectionId === account.connectionId)) break;
      await saveAccounts(accounts.filter((candidate) => candidate.connectionId !== account.connectionId));
      await setNotice(account.provider, `${account.providerName} disconnected this browser. Connect again to keep using it.`);
      await setAccountStatus(account.provider, { state: 'disconnected' });
      connections.sync();
      break;
    }
    case 'unavailable':
      await setAccountStatus(account.provider, { state: 'unavailable', message: `Can't reach ${account.providerName} right now. Retrying.` });
      break;
    default:
      await setAccountStatus(account.provider, { state: 'error', message: 'This relay does not support accounts.' });
  }
}

const connections = new Connections({ onCall, onAccount });

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) connections.ensureConnected();
});
chrome.windows.onRemoved.addListener((windowId) => {
  handleWindowRemoved(windowId);
  handleConnectWindowRemoved(windowId);
});
chrome.runtime.onStartup.addListener(() => connections.ensureConnected());
chrome.runtime.onInstalled.addListener(() => connections.ensureConnected());

// Account calls go to the person's most recently used browser, so say when this one is in use.
let lastPresence = 0;
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || Date.now() - lastPresence < PRESENCE_THROTTLE_MS) return;
  lastPresence = Date.now();
  connections.broadcast({ type: 'active' });
});

clearOrphanPrompts();
clearOrphanConnectPrompts();
connections.sync();

function cleanSite(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';
  return siteOf(input.includes('://') ? input : `https://${input}`);
}

async function state() {
  const [settings, agents, accounts, sites, session, local] = await Promise.all([
    getSettings(),
    getAgents(),
    getAccounts(),
    getSites(),
    chrome.storage.session.get(null),
    chrome.storage.local.get(['activity', 'notices']),
  ]);
  const { browserKey: _secret, ...publicSettings } = settings;
  const accountStatus = session.accountStatus ?? {};
  const pending = session.pendingConnect && session.pendingConnect.expiresAt > Date.now() ? session.pendingConnect : null;
  return {
    settings: publicSettings,
    status: session[statusKey(settings.relayUrl)] ?? { state: 'connecting' },
    agents,
    providers: PROVIDERS.map((provider) => {
      const account = accounts.find((candidate) => candidate.provider === provider.id);
      return {
        id: provider.id,
        name: provider.name,
        connectUrl: provider.connectUrl,
        pending: pending?.provider === provider.id,
        notice: local.notices?.[provider.id] ?? null,
        account: account
          ? {
              id: account.account.id,
              email: account.account.email ?? null,
              name: account.account.name ?? null,
              access: account.access,
              connectedAt: account.connectedAt,
              lastUsedAt: account.lastUsedAt,
              status: accountStatus[provider.id] ?? { state: 'connecting' },
              relay: session[statusKey(account.relayUrl)] ?? { state: 'connecting' },
            }
          : null,
      };
    }),
    sites,
    prompts: session.prompts ?? [],
    connectPrompts: session.connectPrompts ?? [],
    activity: local.activity ?? [],
  };
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
      await connections.syncAgents();
      return agent;
    }

    case 'removeAgent': {
      await saveAgents((await getAgents()).filter((agent) => agent.id !== message.id));
      await connections.syncAgents();
      return state();
    }

    case 'setAgentAccess': {
      const agents = await getAgents();
      const agent = agents.find((candidate) => candidate.id === message.id);
      if (agent) agent.access = message.access === 'control' ? 'control' : 'read';
      await saveAgents(agents);
      await connections.syncAgents();
      return state();
    }

    case 'startConnect':
      await startConnect(message.provider);
      return state();

    case 'cancelConnect':
      await cancelConnect();
      return state();

    case 'setAccountAccess': {
      const accounts = await getAccounts();
      const account = accounts.find((candidate) => candidate.provider === message.provider);
      if (account) account.access = message.access === 'control' ? 'control' : 'read';
      await saveAccounts(accounts);
      await connections.sync();
      return state();
    }

    case 'disconnectAccount': {
      await saveAccounts((await getAccounts()).filter((account) => account.provider !== message.provider));
      await connections.sync();
      return state();
    }

    case 'dismissNotice':
      await setNotice(message.provider, null);
      return state();

    case 'connectDecision':
      await settleConnectPrompt(message.id, {
        decision: message.decision === 'connect' ? 'connect' : 'cancel',
        access: message.access === 'control' ? 'control' : 'read',
      });
      return state();

    case 'setRelayUrl': {
      const relayUrl = String(message.relayUrl ?? '').trim();
      if (!/^wss?:\/\/[^\s]+$/i.test(relayUrl)) throw new Error('Use a ws:// or wss:// address.');
      await updateSettings({ relayUrl });
      await connections.sync();
      return state();
    }

    case 'setBrowserName': {
      const browserName = String(message.browserName ?? '').trim().slice(0, 60);
      if (!browserName) throw new Error('Give this browser a name.');
      await updateSettings({ browserName });
      await connections.restartAll(); // the name travels in the hello
      return state();
    }

    case 'reconnect':
      await connections.restartAll();
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

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleExternalMessage(message, sender, connections).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
  );
  return true;
});
