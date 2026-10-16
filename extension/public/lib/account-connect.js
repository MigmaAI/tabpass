// One-click connect with an account provider (Migma). Two ways in, both safe:
//
// 1. From Tabpass: the person clicks "Connect to Migma". We open the provider's connect page with
//    a one-time nonce. The page (signed in) creates a connection and hands it back with that nonce
//    through chrome.runtime.sendMessage. The nonce proves the person started this here, so no
//    second confirmation is needed.
// 2. From the provider's site (e.g. a "Use my browser" button inside Migma): no nonce, so Tabpass
//    opens its own window and the person confirms there, picking Read or Read and act. A page,
//    even a compromised one, can never connect this browser on its own.

import { randomKey } from './crypto.js';
import { providerById, providerForOrigin, relayAllowed } from './providers.js';
import { getAccounts, getSession, getSettings, saveAccounts, setNotice, setSession } from './store.js';

const NONCE_TTL_MS = 10 * 60 * 1000;
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;
const TEXT = /^[^\u0000-\u001f]{1,200}$/;
const CONNECTION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SECRET = /^[A-Za-z0-9_-]{32,256}$/;

const waiting = new Map(); // promptId -> { resolve, timer, windowId }

export async function startConnect(providerId) {
  const provider = providerById(providerId);
  if (!provider) throw new Error('Unknown provider.');
  const nonce = randomKey();
  const url = new URL(provider.connectUrl);
  url.searchParams.set('tabpass', nonce);
  url.searchParams.set('ext', chrome.runtime.id);
  url.searchParams.set('v', chrome.runtime.getManifest().version);
  const tab = await chrome.tabs.create({ url: url.href, active: true });
  await setSession('pendingConnect', { provider: provider.id, nonce, expiresAt: Date.now() + NONCE_TTL_MS, tabId: tab.id });
}

export async function cancelConnect() {
  await setSession('pendingConnect', null);
}

function publicAccount(account) {
  return account ? { id: account.account.id, email: account.account.email ?? null, name: account.account.name ?? null } : null;
}

function parseConnection(value) {
  const connection = value && typeof value === 'object' ? value : {};
  const account = connection.account && typeof connection.account === 'object' ? connection.account : {};
  if (!CONNECTION_ID.test(connection.connectionId ?? '')) throw new Error('Bad connectionId.');
  if (!SECRET.test(connection.secret ?? '')) throw new Error('Bad secret.');
  if (typeof connection.relayUrl !== 'string') throw new Error('Bad relayUrl.');
  if (!TEXT.test(account.id ?? '')) throw new Error('Bad account id.');
  for (const field of ['email', 'name']) {
    if (account[field] !== undefined && !TEXT.test(account[field])) throw new Error(`Bad account ${field}.`);
  }
  return {
    connectionId: connection.connectionId,
    secret: connection.secret,
    relayUrl: connection.relayUrl,
    account: { id: account.id, ...(account.email ? { email: account.email } : {}), ...(account.name ? { name: account.name } : {}) },
  };
}

async function connectFromProvider(provider, message, sender, connections) {
  const connection = parseConnection(message.connection);
  if (!relayAllowed(provider, connection.relayUrl)) throw new Error(`${provider.name} can only use its own relay over wss://.`);

  const accounts = await getAccounts();
  const existing = accounts.find((account) => account.provider === provider.id) ?? null;
  const pending = await getSession('pendingConnect', null);
  const started =
    typeof message.nonce === 'string' &&
    pending?.provider === provider.id &&
    pending.nonce === message.nonce &&
    pending.expiresAt > Date.now();

  let access;
  if (started) {
    await setSession('pendingConnect', null); // one use
    access = existing && existing.account.id === connection.account.id ? existing.access : 'read';
  } else {
    const decision = await askToConnect(provider, connection.account, existing?.account ?? null);
    if (decision.decision !== 'connect') return { connected: false, reason: decision.decision === 'timeout' ? 'timeout' : 'declined' };
    access = decision.access === 'control' ? 'control' : 'read';
  }

  const now = Date.now();
  const saved = {
    provider: provider.id,
    providerName: provider.name,
    ...connection,
    access,
    connectedAt: now,
    lastUsedAt: null,
  };
  await saveAccounts([...accounts.filter((account) => account.provider !== provider.id), saved]);
  await setNotice(provider.id, null);
  await connections.sync();

  // We opened that tab for the flow; close it so the person lands back where they were.
  if (started && sender.tab?.id && sender.tab.id === pending.tabId) {
    setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => undefined), 1500);
  }
  const { browserName } = await getSettings();
  return { connected: true, access, browserName };
}

/** Messages from a provider's website. The origin is checked by Chrome (externally_connectable) and again here. */
export async function handleExternalMessage(message, sender, connections) {
  const provider = providerForOrigin(sender.origin);
  if (!provider) throw new Error('This site cannot use Tabpass.');
  const account = (await getAccounts()).find((candidate) => candidate.provider === provider.id) ?? null;

  switch (message?.type) {
    case 'tabpass.hello': {
      const { browserName } = await getSettings();
      return {
        extension: 'tabpass',
        version: chrome.runtime.getManifest().version,
        browserName,
        connected: Boolean(account),
        account: publicAccount(account),
        access: account?.access ?? null,
      };
    }
    case 'tabpass.connect':
      return connectFromProvider(provider, message, sender, connections);
    case 'tabpass.disconnect': {
      // Removing access needs no confirmation. With a connectionId, only that connection goes.
      if (!account || (message.connectionId && message.connectionId !== account.connectionId)) return { disconnected: false };
      await saveAccounts((await getAccounts()).filter((candidate) => candidate.provider !== provider.id));
      await connections.sync();
      return { disconnected: true };
    }
    default:
      throw new Error('Unknown request.');
  }
}

// ---------- confirm window (site-initiated connects) ----------

async function askToConnect(provider, account, replaces) {
  const prompts = await getSession('connectPrompts', []);
  for (const previous of prompts.filter((prompt) => prompt.provider === provider.id)) {
    await settleConnectPrompt(previous.id, { decision: 'cancel' }); // newest request wins
  }
  const id = crypto.randomUUID();
  const fresh = (await getSession('connectPrompts', [])).filter((prompt) => prompt.provider !== provider.id);
  fresh.push({ id, provider: provider.id, providerName: provider.name, account, replaces, createdAt: Date.now() });
  await setSession('connectPrompts', fresh);

  return new Promise((resolve) => {
    const timer = setTimeout(() => settleConnectPrompt(id, { decision: 'timeout' }), CONFIRM_TIMEOUT_MS);
    waiting.set(id, { resolve, timer, windowId: null });
    chrome.windows
      .create({
        url: chrome.runtime.getURL(`prompt.html?connect=${encodeURIComponent(id)}`),
        type: 'popup',
        width: 420,
        height: 520,
        focused: true,
      })
      .then((win) => {
        const entry = waiting.get(id);
        if (entry) entry.windowId = win.id ?? null;
        else if (win.id) chrome.windows.remove(win.id).catch(() => undefined);
      })
      .catch(() => undefined);
  });
}

export async function settleConnectPrompt(id, decision) {
  const entry = waiting.get(id);
  waiting.delete(id);
  const prompts = await getSession('connectPrompts', []);
  await setSession(
    'connectPrompts',
    prompts.filter((prompt) => prompt.id !== id)
  );
  if (!entry) return;
  clearTimeout(entry.timer);
  if (entry.windowId) chrome.windows.remove(entry.windowId).catch(() => undefined);
  entry.resolve(decision);
}

export function handleConnectWindowRemoved(windowId) {
  for (const [id, entry] of waiting) {
    if (entry.windowId === windowId) {
      entry.windowId = null;
      settleConnectPrompt(id, { decision: 'cancel' });
    }
  }
}

export async function clearOrphanConnectPrompts() {
  const prompts = await getSession('connectPrompts', []);
  const live = prompts.filter((prompt) => waiting.has(prompt.id));
  if (live.length !== prompts.length) await setSession('connectPrompts', live);
}
