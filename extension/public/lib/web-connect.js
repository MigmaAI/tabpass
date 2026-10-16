// Tabpass Web Protocol v1, extension side (spec: docs/web-protocol.md). Lets a website that
// supports Tabpass connect itself as an AI tool in one click, confirmed in Tabpass's own window:
//
//   hello       is Tabpass here?                 { name, version, protocol, connected }
//   status      is this site connected?          { connected, access, name }
//   connect     ask the person to connect        { token, mcpUrl, connectorUrl, access, name }
//   disconnect  remove this site's connections   { disconnected }
//
// The relay's own sign-in page (MCP OAuth) is just such a site: it asks with `relay: true`, so the
// agent lives on that relay and the token goes back to the AI tool that is signing in.

import { createAgentToken, relayKey } from './crypto.js';
import { ask, pending, settle } from './prompt-window.js';
import { providerForOrigin } from './providers.js';
import {
  addActivity,
  agentRelay,
  getAccounts,
  getAgents,
  getSettings,
  mcpUrlFor,
  nextAgentColor,
  relayOrigin,
  saveAgents,
} from './store.js';

const PROTOCOL = 1;
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;
const NAME = /^[^\u0000-\u001f]{1,40}$/;
const SHORT_TEXT = /^[^\u0000-\u001f]{1,80}$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/;

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function hostOf(origin) {
  return new URL(origin).host;
}

/** Origins that may talk to Tabpass without a click: relays it uses, providers, connected sites. */
async function isKnown(origin) {
  if (providerForOrigin(origin)) return true;
  const [settings, agents, accounts] = await Promise.all([getSettings(), getAgents(), getAccounts()]);
  const relays = [settings.relayUrl, ...agents.map((agent) => agentRelay(agent, settings)), ...accounts.map((account) => account.relayUrl)];
  return relays.some((relayUrl) => relayOrigin(relayUrl) === origin) || agents.some((agent) => agent.origin === origin);
}

/** A page may only name itself as the relay; it must be TLS unless it is on this computer. */
function relayForOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol === 'https:') return `wss://${url.host}/extension`;
  if (url.protocol === 'http:' && LOCAL_HOST.test(url.hostname)) return `ws://${url.host}/extension`;
  return null;
}

/** Socket readiness only; the website's backend must verify the new MCP credential. */
async function waitForRelay(relayUrl, timeoutMs = 8000) {
  const key = `status:${relayUrl}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (await chrome.storage.session.get(key))[key];
    if (status?.state === 'connected') return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function connect(origin, params, connections) {
  const name = typeof params.name === 'string' && NAME.test(params.name.trim()) ? params.name.trim() : hostOf(origin);
  const requested = params.access === 'control' ? 'control' : 'read';
  const returnsTo = typeof params.returnsTo === 'string' && SHORT_TEXT.test(params.returnsTo) ? params.returnsTo : null;
  const settings = await getSettings();
  const relayUrl = params.relay === true ? relayForOrigin(origin) : settings.relayUrl;
  if (!relayUrl) return failure('invalid', 'A relay must use https.');

  if ((await pending('agent')).some((prompt) => prompt.origin === origin)) {
    return failure('busy', 'Tabpass is already asking about this site.');
  }
  const agents = await getAgents();
  const replaces = agents.find((agent) => agent.origin === origin && agent.label === name && agentRelay(agent, settings) === relayUrl) ?? null;

  const decision = await ask(
    'agent',
    {
      origin,
      site: hostOf(origin),
      name,
      requestedAccess: requested,
      relayHost: new URL(relayOrigin(relayUrl)).host,
      viaRelay: params.relay === true,
      returnsTo,
      replaces: Boolean(replaces),
    },
    { timeoutMs: CONFIRM_TIMEOUT_MS, timeoutDecision: { decision: 'timeout' }, cancelDecision: { decision: 'cancel' } }
  );
  if (decision.decision === 'timeout') return failure('timeout', 'Nobody answered in Tabpass.');
  if (decision.decision !== 'connect') return failure('declined', 'The person did not connect Tabpass.');

  const access = decision.access === 'control' ? 'control' : 'read';
  const { token, tokenHash } = await createAgentToken(await relayKey(settings.browserKey, relayUrl));
  const current = await getAgents();
  const agent = {
    id: crypto.randomUUID(),
    label: name,
    access,
    token,
    tokenHash,
    color: replaces?.color ?? nextAgentColor(current),
    createdAt: Date.now(),
    lastUsedAt: null,
    relayUrl,
    origin,
    source: params.relay === true ? 'oauth' : 'web',
    returnsTo,
  };
  await saveAgents([...current.filter((candidate) => candidate.id !== replaces?.id), agent]);
  await connections.sync();
  await connections.syncAgents();
  if (!await waitForRelay(relayUrl)) {
    // Keep the grant visible and revocable. Restoring an old array here could overwrite
    // another connection or permission change made while the relay was unavailable.
    return failure('relay_unavailable', 'Tabpass could not connect to its relay. Try again when it is online.');
  }
  await addActivity({ agent: name, tool: 'connected', site: hostOf(origin), ok: true });

  const mcpUrl = mcpUrlFor(relayUrl);
  return { ok: true, result: { token, mcpUrl, connectorUrl: `${mcpUrl}/${token}`, access, name } };
}

/** Handles one request from bridge.js. `sender.origin` comes from Chrome, not from the page. */
export async function handleWebMessage(message, sender, connections) {
  const origin = sender.origin;
  if (!origin || origin === 'null' || sender.frameId !== 0 || !/^https?:/.test(origin)) return { silent: true };
  const activated = message.activated === true;
  const known = await isKnown(origin);
  const params = message.params && typeof message.params === 'object' ? message.params : {};

  switch (message.method) {
    case 'hello':
    case 'status': {
      if (!known && !activated) return { silent: true };
      const agent = (await getAgents()).find((candidate) => candidate.origin === origin) ?? null;
      if (message.method === 'hello') {
        return { ok: true, result: { name: 'Tabpass', version: chrome.runtime.getManifest().version, protocol: PROTOCOL, connected: Boolean(agent) } };
      }
      return { ok: true, result: { connected: Boolean(agent), access: agent?.access ?? null, name: agent?.label ?? null } };
    }
    case 'connect':
      // Only right after a click: a page can never pop windows on its own.
      if (!activated) return known ? failure('activation_required', 'Call connect from a click.') : { silent: true };
      return connect(origin, params, connections);
    case 'disconnect': {
      if (!known && !activated) return { silent: true };
      const agents = await getAgents();
      const keep = agents.filter((agent) => agent.origin !== origin);
      await saveAgents(keep);
      await connections.syncAgents();
      await connections.sync();
      return { ok: true, result: { disconnected: agents.length - keep.length } };
    }
    default:
      return known || activated ? failure('unknown_method', `Unknown method ${String(message.method)}.`) : { silent: true };
  }
}

export { settle as settleAgentPrompt };
