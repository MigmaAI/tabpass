// End-to-end test: real Chromium with the built extension, the relay (OAuth on), MCP clients as AI
// tools, a third-party "AI site" speaking the Tabpass Web Protocol, and a fake Migma for the
// one-click account flow. Drives the side panel like a person would.
//
//   yarn --cwd relay build && yarn --cwd extension build:dev && cd e2e && xvfb-run -a node run.mjs
//
// SCREENSHOT_DIR=/some/dir saves screenshots of every screen and prompt for a visual check.

import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium } from 'playwright';

import { createRelayServer, httpAccountVerifier } from '../relay/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(here, '..', 'extension', 'dist');
const screenshotDir = process.env.SCREENSHOT_DIR;
const executablePath = process.env.CHROMIUM_PATH || undefined;
const PROVIDER_PORT = 47821; // the dev build trusts http://localhost:47821 as Migma
const VERIFY_SECRET = 'relay-to-migma';
const INTERNAL_SECRET = 'migma-to-relay';
const RELAY_SECRET = 'e2e-relay-secret-that-is-long-enough-for-oauth';

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✗ ${name}\n    ${error?.stack ?? error}`);
    throw error;
  }
}

const textOf = (result) => result.content.map((item) => item.text ?? '').join('\n');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serve(handler, port = 0, host = '127.0.0.1') {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

// ---------- fixture sites ("127.0.0.1", "localhost", "127.0.0.2") ----------

const fixtures = await serve(
  async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      const body = await readFile(join(here, 'fixtures', path === '/' ? 'form.html' : path.slice(1)));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  },
  0,
  '0.0.0.0'
);
const fixturePort = fixtures.address().port;
const siteA = `http://127.0.0.1:${fixturePort}`;
const siteB = `http://localhost:${fixturePort}`;
const siteC = `http://127.0.0.2:${fixturePort}`;

// ---------- relay: OAuth on, account mode verifying against the fake Migma ----------

const probe = await serve(() => undefined);
const relayPort = probe.address().port;
probe.close();
const relayHttp = `http://127.0.0.1:${relayPort}`;
const relayWs = `ws://127.0.0.1:${relayPort}/extension`;
const startRelay = () =>
  createRelayServer({
    publicUrl: relayHttp,
    secret: RELAY_SECRET,
    accounts: httpAccountVerifier({ url: `http://localhost:${PROVIDER_PORT}/internal/tabpass/verify`, secret: VERIFY_SECRET }),
    internalSecret: INTERNAL_SECRET,
    log: () => undefined,
  });
let relay = startRelay();
await relay.listen(relayPort, '127.0.0.1');

// ---------- fake Migma ----------

const connections = new Map(); // connectionId -> { secret, accountId, browserId }
const ACCOUNTS = { user_alice: { email: 'alice@example.com', name: 'Alice' }, user_bob: { email: 'bob@example.com', name: 'Bob' } };
const provider = await serve(
  async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = await new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
    });
    if (url.pathname === '/connect/browser' || url.pathname === '/app') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(await readFile(join(here, 'provider', 'connect.html')));
    } else if (url.pathname === '/api/connections' && req.method === 'POST') {
      const connectionId = `conn_${randomBytes(8).toString('hex')}`;
      const secret = randomBytes(32).toString('base64url');
      connections.set(connectionId, { secret, accountId: body.accountId, browserId: null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connectionId, secret, relayUrl: body.relayUrl ?? relayWs, account: { id: body.accountId, ...ACCOUNTS[body.accountId] } }));
    } else if (url.pathname === '/internal/tabpass/verify' && req.method === 'POST') {
      const known = connections.get(body.connectionId);
      const authorized = req.headers.authorization === `Bearer ${VERIFY_SECRET}`;
      const ok = authorized && known && known.secret === body.secret && (!known.browserId || known.browserId === body.browserId);
      if (ok) known.browserId = body.browserId;
      res.writeHead(!authorized ? 401 : ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { accountId: known.accountId, name: ACCOUNTS[known.accountId].name } : { error: 'unknown' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  },
  PROVIDER_PORT,
  'localhost'
);
const providerUrl = `http://localhost:${PROVIDER_PORT}`;

async function migmaCall(accountId, tool, args = {}, via = 'Claude') {
  const response = await fetch(`${relayHttp}/internal/accounts/${accountId}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTERNAL_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args, via }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

// ---------- an MCP client's OAuth redirect target ----------

let lastCallback = null;
const callbackServer = await serve((req, res) => {
  lastCallback = new URL(req.url, 'http://127.0.0.1');
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<title>Signed in</title><p>You can close this window.</p>');
});
const callbackUrl = `http://127.0.0.1:${callbackServer.address().port}/callback`;

// ---------- browser ----------

const userDataDir = await mkdtemp(join(tmpdir(), 'tabpass-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath,
  viewport: { width: 1200, height: 800 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
});

let exitCode = 0;
const clients = [];

async function connectAgent(url, init) {
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), init));
  clients.push(client);
  return client;
}

const waitForPage = (fragment) => context.waitForEvent('page', { predicate: (page) => page.url().includes(fragment), timeout: 15000 });

async function answerPrompt(buttonText, shot) {
  const prompt = await waitForPage('prompt.html?id=');
  await prompt.waitForLoadState('domcontentloaded');
  const button = prompt.getByRole('button', { name: buttonText, exact: true });
  await button.waitFor();
  if (screenshotDir && shot) await shootPrompt(prompt, shot);
  await button.click();
  return prompt;
}

/** Prompt windows are 420 wide in Chrome; shoot them at that size. */
async function shootPrompt(page, name) {
  if (!screenshotDir) return;
  await page.setViewportSize({ width: 420, height: 600 });
  await sleep(200);
  await page.screenshot({ path: join(screenshotDir, name) });
}

async function shoot(page, name, options = {}) {
  if (!screenshotDir) return;
  await sleep(350); // let the push animation finish
  await page.screenshot({ path: join(screenshotDir, name), ...options });
}

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 860 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const row = (name) => panel.getByRole('button', { name, exact: true });
  const back = () => panel.locator('header button').first().click();
  const region = (name) => panel.getByRole('region', { name });

  let controlUrl;
  let control;
  let formTabId;

  console.log('Side panel');
  await step('first run explains what leaves the browser; the relay is set under This browser', async () => {
    await panel.getByText('You stay in charge').waitFor();
    await shoot(panel, 'home-first-run.png');
    await panel.getByRole('button', { name: 'Got it' }).click();
    await panel.getByRole('button', { name: /This browser/ }).click();
    await panel.locator('#relay-url').fill(relayWs);
    await panel.locator('form', { has: panel.locator('#relay-url') }).getByRole('button', { name: 'Save' }).click();
    await panel.getByText(`Connected. AI tools reach this browser through 127.0.0.1:${relayPort}.`).waitFor({ timeout: 10000 });
    await back();
    await panel.getByRole('status').getByText(/^Connected · Chrome on/).waitFor();
    assert.equal((await relay.directory.stats()).browsers, 1);
  });

  await step('"Connect an AI tool" shows one link for every tool, and one-click buttons', async () => {
    await row('Connect an AI tool').click();
    await panel.locator('code', { hasText: `${relayHttp}/mcp` }).first().waitFor();
    await shoot(panel, 'connect.png', { fullPage: true });
    await row('Claude').click();
    await panel.getByRole('button', { name: 'Add to Claude' }).waitFor();
    await panel.getByText(/connects from the internet, so it cannot reach a relay on this computer/).waitFor();
    await shoot(panel, 'tool-claude.png', { fullPage: true });
    await back();
  });

  await step('a link with a key, for tools without sign-in, starts at Read and can be raised', async () => {
    await row('Make a link with a key').click();
    await panel.getByRole('button', { name: 'Claude', exact: true }).click();
    assert.equal(await panel.getByRole('radio', { name: 'Read', exact: true }).getAttribute('aria-checked'), 'true');
    await panel.getByRole('radio', { name: 'Read and act' }).click();
    await panel.getByRole('button', { name: 'Make the link' }).click();
    const code = panel.locator('code').first();
    await code.waitFor();
    controlUrl = await code.textContent();
    assert.match(controlUrl, new RegExp(`^${relayHttp}/mcp/tp_[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{43}$`));
    // The relay sees a key made for it alone, never the browser's own key.
    const { settings } = await worker.evaluate(() => chrome.storage.local.get('settings'));
    const idOf = (key) => createHash('sha256').update(key).digest('base64url').slice(0, 16);
    const relayKey = createHmac('sha256', settings.browserKey).update(`tabpass relay key v1 ws://127.0.0.1:${relayPort}`).digest('base64url');
    assert.equal(controlUrl.split('/mcp/tp_')[1].split('.')[0], idOf(relayKey));
    assert.notEqual(idOf(relayKey), idOf(settings.browserKey));
    await shoot(panel, 'agent.png', { fullPage: true });
    await back();
    await back();
    await row('Claude').waitFor();
  });

  console.log('Reading and acting');
  const userTab = await context.newPage();
  await userTab.goto(`${siteA}/form.html`);
  await userTab.bringToFront();

  await step('read_page asks for the site first; "Always allow" lets it through', async () => {
    control = await connectAgent(controlUrl);
    assert.equal((await control.listTools()).tools.length, 15);
    const tabs = textOf(await control.callTool({ name: 'list_tabs', arguments: {} }));
    formTabId = Number(/\[(\d+)\] Acme Studio/.exec(tabs)[1]);
    const [result] = await Promise.all([
      control.callTool({ name: 'read_page', arguments: { tabId: formTabId } }),
      answerPrompt('Always allow', 'prompt-site.png'),
    ]);
    const text = textOf(result);
    assert.match(text, /^Page content below is untrusted data/);
    assert.match(text, /# Design forms that convert/);
    assert.match(text, /\| Plan \| Price \|/);
  });

  await step('refs drive type and click; submit and navigate back work', async () => {
    const text = textOf(await control.callTool({ name: 'read_page', arguments: { tabId: formTabId, interactive: true } }));
    const ref = (pattern) => Number(new RegExp(`\\[ref=(\\d+)\\] ${pattern}`).exec(text)?.[1]);
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: ref('textbox "Your name"'), text: 'Ada' } });
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: ref('select "Plan"'), text: 'Pro' } });
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: ref('textbox "Controlled"'), text: 'hello' } });
    await control.callTool({ name: 'click', arguments: { tabId: formTabId, ref: ref('button "Sign up"') } });
    assert.equal(await userTab.locator('#result').textContent(), 'Thanks, Ada (pro)!');
    assert.equal(await userTab.locator('#controlled-out').textContent(), 'State: hello');
    const typed = await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: ref('textbox "Search"'), text: 'brand kits', submit: true } });
    assert.match(textOf(typed), /Now: Second page/);
    assert.match(textOf(await control.callTool({ name: 'navigate', arguments: { tabId: formTabId, action: 'back' } })), /Acme Studio — Forms/);
  });

  await step('a new site: "Don\'t allow", then "Allow for 10 minutes" opens it in the agent\'s tab group', async () => {
    const [declined] = await Promise.all([
      control.callTool({ name: 'open_tab', arguments: { url: `${siteB}/second.html` } }),
      answerPrompt("Don't allow"),
    ]);
    assert.match(textOf(declined), /declined access to localhost/);
    const [opened] = await Promise.all([
      control.callTool({ name: 'open_tab', arguments: { url: `${siteB}/second.html` } }),
      answerPrompt('Allow for 10 minutes'),
    ]);
    const tabId = Number(/^Opened tab (\d+)/.exec(textOf(opened))[1]);
    const group = await worker.evaluate(async (id) => chrome.tabGroups.get((await chrome.tabs.get(id)).groupId), tabId);
    assert.equal(group.title, 'Claude');
    assert.match(textOf(await control.callTool({ name: 'close_tabs', arguments: { tabIds: [tabId] } })), /Closed 1 tab/);
  });

  console.log('One URL for every AI tool (OAuth)');
  await step('an MCP client signs in with one URL: authorize page → approve in Tabpass → token', async () => {
    let saved;
    let tokens;
    let verifier = '';
    let authorizeUrl = null;
    const providerImpl = {
      get redirectUrl() {
        return callbackUrl;
      },
      get clientMetadata() {
        return { client_name: 'Claude Code', redirect_uris: [callbackUrl], token_endpoint_auth_method: 'none' };
      },
      clientInformation: () => saved,
      saveClientInformation: (info) => void (saved = info),
      tokens: () => tokens,
      saveTokens: (next) => void (tokens = next),
      redirectToAuthorization: (url) => void (authorizeUrl = url),
      saveCodeVerifier: (value) => void (verifier = value),
      codeVerifier: () => verifier,
    };
    const first = new StreamableHTTPClientTransport(new URL(`${relayHttp}/mcp`), { authProvider: providerImpl });
    await assert.rejects(new Client({ name: 'oauth', version: '1' }).connect(first), /Unauthorized/);
    assert.ok(authorizeUrl, 'the client was sent to /authorize');

    // What the MCP client does: open the authorize URL in the person's browser.
    const page = await context.newPage();
    await page.goto(authorizeUrl.href);
    await page.getByRole('heading', { name: 'Connect Claude Code to your browser' }).waitFor();
    await shootPrompt(page, 'authorize.png');
    const promptOpened = waitForPage('prompt.html?agent=');
    await page.getByRole('button', { name: 'Continue in Tabpass' }).click();
    const prompt = await promptOpened;
    await prompt.getByRole('heading', { name: 'Connect Claude Code to your browser?' }).waitFor();
    await prompt.getByText(/Signing in through 127\.0\.0\.1:\d+, back to an app on this computer\./).waitFor();
    await shootPrompt(prompt, 'prompt-agent.png');
    await prompt.getByRole('radio', { name: 'Read and act' }).click();
    await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.waitForURL(/\/callback\?/, { timeout: 15000 });
    assert.ok(lastCallback?.searchParams.get('code')?.startsWith('tpo_'));
    assert.equal(lastCallback.searchParams.get('iss'), relayHttp);
    await first.finishAuth(lastCallback.searchParams.get('code'));
    await page.close();

    const signedIn = await connectAgent(`${relayHttp}/mcp`, { authProvider: providerImpl });
    assert.equal((await signedIn.listTools()).tools.length, 15, 'Read and act, as chosen in Tabpass');
    assert.match(textOf(await signedIn.callTool({ name: 'list_tabs', arguments: {} })), /Acme Studio/);
    await row('Claude Code').waitFor();
    await row('Claude Code').click();
    await panel.getByText(/Signed in from an app on this computer/).waitFor();
    await back();
  });

  console.log('Tabpass Web Protocol');
  await step('an unknown site gets no answer without a click, then connects in one click', async () => {
    const site = await context.newPage();
    await site.goto(`${siteC}/ai-site.html`);
    await site.locator('#silent').getByText('no answer').waitFor({ timeout: 5000 });
    const promptOpened = waitForPage('prompt.html?agent=');
    await site.getByRole('button', { name: 'Connect your browser' }).click();
    const prompt = await promptOpened;
    await prompt.getByText('127.0.0.2:' + fixturePort + ' asked to connect.', { exact: false }).waitFor();
    await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
    await site.locator('#result').getByText('"token":"tp_').waitFor({ timeout: 10000 });
    const { token, mcpUrl, access } = JSON.parse(await site.locator('#result').textContent());
    assert.equal(mcpUrl, `${relayHttp}/mcp`);
    assert.equal(access, 'read');
    const fromSite = await connectAgent(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    assert.equal((await fromSite.listTools()).tools.length, 6);

    // Now the site is known: status answers without a click, and it can disconnect itself.
    await site.reload();
    await site.locator('#silent').getByText(/^answered .*"connected":true/).waitFor({ timeout: 5000 });
    await site.getByRole('button', { name: 'Disconnect' }).click();
    await site.locator('#result').getByText('"disconnected":1').waitFor();
    await sleep(300);
    await assert.rejects(connectAgent(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }), /401|was removed/);
    await site.close();
  });

  console.log('Connect to Migma');
  await step('"Connect" on Home pairs Migma in one click and closes the Migma tab', async () => {
    const opened = waitForPage('/connect/browser');
    await region('Migma').getByRole('button', { name: 'Connect', exact: true }).click();
    const connectTab = await opened;
    await connectTab.waitForEvent('close', { timeout: 10000 });
    await region('Migma').getByText('alice@example.com').waitFor();
    assert.equal((await relay.directory.stats()).accounts, 1);
    const tabs = textOf(await migmaCall('user_alice', 'list_tabs'));
    assert.match(tabs, /Acme Studio/);
    assert.match(textOf(await migmaCall('user_bob', 'list_tabs')), /No browser is connected/);
    await shoot(panel, 'home.png', { fullPage: true });
  });

  await step('Migma\'s site cannot connect silently; it asks in Tabpass\'s window', async () => {
    const app = await context.newPage();
    await app.goto(`${providerUrl}/app?ext=${extensionId}&as=user_bob`);
    const promptOpened = waitForPage('prompt.html?connect=');
    await app.getByRole('button', { name: 'Use my browser' }).click();
    const confirm = await promptOpened;
    await confirm.getByText('This replaces alice@example.com.').waitFor();
    await shootPrompt(confirm, 'prompt-account.png');
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await app.locator('#result').getByText('"connected":false').waitFor();
    await app.getByRole('button', { name: 'Connect with another relay' }).click();
    await app.locator('#result').getByText('can only use its own relay').waitFor();
    await app.close();
  });

  await step('revoking in Migma disconnects the browser and says so', async () => {
    const connectionId = [...connections.entries()].find(([, value]) => value.accountId === 'user_alice' && value.browserId)[0];
    connections.delete(connectionId);
    const response = await fetch(`${relayHttp}/internal/accounts/user_alice/connections/${connectionId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    assert.deepEqual(await response.json(), { revoked: 1 });
    await region('Migma').getByText('Migma disconnected this browser. Connect again to keep using it.').waitFor();
  });

  console.log('Safety switches');
  await step('the switch pauses every agent; Sites lists what was allowed', async () => {
    await panel.getByRole('switch', { name: 'Let agents use this browser' }).click();
    await panel.getByRole('status').getByText(/^Paused/).waitFor();
    assert.match(textOf(await control.callTool({ name: 'list_tabs', arguments: {} })), /paused/);
    await panel.getByRole('switch', { name: 'Let agents use this browser' }).click();
    assert.ok(!(await control.callTool({ name: 'list_tabs', arguments: {} })).isError);
    await panel.getByRole('button', { name: /^Sites/ }).click();
    await region('Always allowed').getByText('127.0.0.1').waitFor();
    await shoot(panel, 'sites.png', { fullPage: true });
    await back();
  });

  await step('the panel fits its width in light and dark mode', async () => {
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (screenshotDir) {
      await panel.emulateMedia({ colorScheme: 'dark' });
      await shoot(panel, 'home-dark.png', { fullPage: true });
      await row('Connect an AI tool').click();
      await shoot(panel, 'connect-dark.png');
      await back();
      await panel.emulateMedia({ colorScheme: 'light' });
    }
  });

  await step('the extension reconnects after the relay restarts; sign-ins survive (same secret)', async () => {
    relay.close();
    await sleep(300);
    relay = startRelay();
    await relay.listen(relayPort, '127.0.0.1');
    const deadline = Date.now() + 15000;
    while ((await relay.directory.stats()).browsers === 0 && Date.now() < deadline) await sleep(200);
    assert.equal((await relay.directory.stats()).browsers, 1);
    const fresh = await connectAgent(controlUrl);
    assert.ok(!(await fresh.callTool({ name: 'list_tabs', arguments: {} })).isError);
  });

  await step('disconnecting an AI tool in the panel cuts its link at once', async () => {
    await row('Claude').click();
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await panel.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    await row('Claude').waitFor({ state: 'detached' });
    await sleep(200);
    await assert.rejects(connectAgent(controlUrl), /401|was removed/);
  });
} catch {
  exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  await context.close();
  relay.close();
  fixtures.close();
  provider.close();
  callbackServer.close();
  await rm(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(exitCode || (failed ? 1 : 0));
