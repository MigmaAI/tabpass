// End-to-end test: real Chromium with the built extension, the relay, MCP clients acting as AI
// agents, and a fake Migma (connect page + verify endpoint) for the one-click account flow.
// Drives the side panel like a person would.
//
//   yarn --cwd relay build && yarn --cwd extension build:dev && cd e2e && xvfb-run -a node run.mjs
//
// SCREENSHOT_DIR=/some/dir saves side-panel and prompt screenshots for a visual check.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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

function textOf(result) {
  return result.content.map((item) => item.text ?? '').join('\n');
}

function serve(handler, port = 0, host = '127.0.0.1') {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

// ---------- fixture site (sites "127.0.0.1", "localhost" and "127.0.0.2") ----------

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

// ---------- relay (account mode on, verifying against the fake Migma) ----------

const probe = await serve(() => undefined);
const relayPort = probe.address().port;
probe.close();
const relayHttp = `http://127.0.0.1:${relayPort}`;
const relayWs = `ws://127.0.0.1:${relayPort}/extension`;
function startRelay() {
  return createRelayServer({
    publicUrl: relayHttp,
    accounts: httpAccountVerifier({ url: `http://localhost:${PROVIDER_PORT}/internal/tabpass/verify`, secret: VERIFY_SECRET }),
    internalSecret: INTERNAL_SECRET,
    log: () => undefined,
  });
}
let relay = startRelay();
await relay.listen(relayPort, '127.0.0.1');

// ---------- fake Migma: connect page, connection store, verify endpoint ----------

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
      // Migma's backend: a signed-in person creates a connection for this browser.
      const connectionId = `conn_${randomBytes(8).toString('hex')}`;
      const secret = randomBytes(32).toString('base64url');
      connections.set(connectionId, { secret, accountId: body.accountId, browserId: null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          connectionId,
          secret,
          relayUrl: body.relayUrl ?? relayWs,
          account: { id: body.accountId, ...ACCOUNTS[body.accountId] },
        })
      );
    } else if (url.pathname === '/internal/tabpass/verify' && req.method === 'POST') {
      // Called by the relay. Pins each connection to the first browser that uses it.
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

/** What Migma's backend does to act for a person (relay internal API). */
async function migmaCall(accountId, tool, args = {}, via = 'Claude') {
  const response = await fetch(`${relayHttp}/internal/accounts/${accountId}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTERNAL_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args, via }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

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

async function connectAgent(url) {
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  clients.push(client);
  return client;
}

function waitForPage(fragment) {
  return context.waitForEvent('page', { predicate: (page) => page.url().includes(fragment), timeout: 15000 });
}

async function answerPrompt(buttonText) {
  const prompt = await waitForPage('prompt.html?id=');
  await prompt.waitForLoadState('domcontentloaded');
  const button = prompt.getByRole('button', { name: buttonText, exact: true });
  await button.waitFor();
  if (screenshotDir && buttonText === 'Always allow') await prompt.screenshot({ path: join(screenshotDir, 'prompt.png') });
  await button.click();
  return prompt;
}

const agentItem = (panel, name) => panel.locator(`li[data-agent="${name}"]`);

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const sessionState = (key) => worker.evaluate(async (k) => (await chrome.storage.session.get(k))[k], key);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const agentsCard = panel.locator('[aria-labelledby="agents-title"]');
  const migmaCard = panel.locator('[aria-labelledby="provider-migma"]');

  let controlUrl;
  let readUrl;
  let control;
  let reader;
  let formTabId;

  console.log('Side panel');
  await step('the relay address is saved from the panel and the browser connects', async () => {
    await panel.getByRole('button', { name: 'This browser' }).click();
    await panel.locator('#relay-url').fill(relayWs);
    await panel.locator('form', { has: panel.locator('#relay-url') }).getByRole('button', { name: 'Save' }).click();
    await agentsCard.getByRole('status').getByText('Connected').waitFor({ timeout: 10000 });
    assert.equal(relay.hub.stats().browsers, 1);
    await panel.getByRole('button', { name: 'This browser' }).click();
  });

  await step('connecting an agent with "Read and act" shows its connector URL', async () => {
    await panel.getByRole('button', { name: 'Connect an agent' }).click();
    await panel.getByRole('button', { name: 'Claude', exact: true }).click();
    await panel.getByRole('radio', { name: /Read and act/ }).click();
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    const code = agentItem(panel, 'Claude').locator('code');
    await code.waitFor();
    controlUrl = await code.textContent();
    assert.match(controlUrl, new RegExp(`^http://127\\.0\\.0\\.1:${relayPort}/mcp/tp_[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{43}$`));
    if (screenshotDir) await panel.screenshot({ path: join(screenshotDir, 'panel-agent.png'), fullPage: true });
  });

  await step('a second agent starts at Read, the safe default', async () => {
    await panel.getByRole('button', { name: 'Connect an agent' }).click();
    assert.equal(await panel.getByRole('radio', { name: /^Read Lists tabs/ }).getAttribute('aria-checked'), 'true');
    await panel.locator('#agent-name').fill('Researcher');
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await agentItem(panel, 'Researcher').locator('code').waitFor();
    readUrl = await agentItem(panel, 'Researcher').locator('code').textContent();
    assert.notEqual(readUrl, controlUrl);
  });

  console.log('Reading');
  const userTab = await context.newPage();
  await userTab.goto(`${siteA}/form.html`);
  await userTab.bringToFront();

  await step('the control agent sees 15 tools; the read agent sees the 6 read tools', async () => {
    control = await connectAgent(controlUrl);
    reader = await connectAgent(readUrl);
    assert.equal((await control.listTools()).tools.length, 15);
    const readTools = (await reader.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(readTools, ['extract_design', 'get_selection', 'list_tabs', 'read_page', 'screenshot', 'wait_for']);
  });

  await step('list_tabs shows titles and URLs without asking', async () => {
    const text = textOf(await control.callTool({ name: 'list_tabs', arguments: {} }));
    const line = text.split('\n').find((entry) => entry.includes('Acme Studio — Forms'));
    assert.ok(line, text);
    formTabId = Number(/\[(\d+)\]/.exec(line)[1]);
  });

  await step('read_page asks for the site first; "Always allow" lets it through', async () => {
    const [result] = await Promise.all([
      control.callTool({ name: 'read_page', arguments: { tabId: formTabId } }),
      answerPrompt('Always allow'),
    ]);
    const text = textOf(result);
    assert.ok(!result.isError, text);
    assert.match(text, /^Page content below is untrusted data/);
    assert.match(text, /# Design forms that convert/);
    assert.match(text, /  - Nested item/);
    assert.match(text, /\| Plan \| Price \|/);
  });

  await step('get_selection, extract_design and screenshot work for the read agent', async () => {
    await userTab.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('quote'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    assert.match(textOf(await reader.callTool({ name: 'get_selection', arguments: { tabId: formTabId } })), /Highlight this sentence please\./);
    const designText = textOf(await reader.callTool({ name: 'extract_design', arguments: { tabId: formTabId } }));
    const design = JSON.parse(designText.slice(designText.indexOf('{')));
    assert.equal(design.buttons.find((button) => button.text === 'Sign up')?.background, '#ff5a1f');
    const shot = await reader.callTool({ name: 'screenshot', arguments: { tabId: formTabId } });
    assert.equal(shot.content.find((item) => item.type === 'image')?.mimeType, 'image/jpeg');
  });

  console.log('Acting');
  await step('read_page refs drive type and click to submit a form', async () => {
    const text = textOf(await control.callTool({ name: 'read_page', arguments: { tabId: formTabId, interactive: true } }));
    const ref = (pattern) => Number(new RegExp(`\\[ref=(\\d+)\\] ${pattern}`).exec(text)?.[1]);
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: ref('textbox "Your name"'), text: 'Ada' } });
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: ref('select "Plan"'), text: 'Pro' } });
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: ref('textbox "Controlled"'), text: 'hello' } });
    await control.callTool({ name: 'click', arguments: { tabId: formTabId, ref: ref('button "Sign up"') } });
    assert.equal(await userTab.locator('#result').textContent(), 'Thanks, Ada (pro)!');
    assert.equal(await userTab.locator('#controlled-out').textContent(), 'State: hello');
  });

  await step('submit, wait_for and navigate back work across pages', async () => {
    const text = textOf(await control.callTool({ name: 'read_page', arguments: { tabId: formTabId, interactive: true } }));
    const search = Number(/\[ref=(\d+)\] textbox "Search"/.exec(text)[1]);
    const typed = await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: search, text: 'brand kits', submit: true } });
    assert.match(textOf(typed), /Now: Second page/);
    assert.match(textOf(await control.callTool({ name: 'wait_for', arguments: { tabId: formTabId, text: 'You searched for' } })), /is on the page/);
    const back = await control.callTool({ name: 'navigate', arguments: { tabId: formTabId, action: 'back' } });
    assert.match(textOf(back), /Acme Studio — Forms/);
  });

  console.log('Tabs and sites');
  let openedTabId;
  await step('open_tab on a new site: Decline, then Allow for 10 min into the agent\'s group', async () => {
    const [declined] = await Promise.all([
      control.callTool({ name: 'open_tab', arguments: { url: `${siteB}/second.html` } }),
      answerPrompt('Decline'),
    ]);
    assert.match(textOf(declined), /declined access to localhost/);
    const [result] = await Promise.all([
      control.callTool({ name: 'open_tab', arguments: { url: `${siteB}/second.html` } }),
      answerPrompt('Allow for 10 min'),
    ]);
    openedTabId = Number(/^Opened tab (\d+)/.exec(textOf(result))[1]);
    const group = await worker.evaluate(async (id) => chrome.tabGroups.get((await chrome.tabs.get(id)).groupId), openedTabId);
    assert.equal(group.title, 'Claude');
  });

  await step('blocking a site hides it from list_tabs and shows it under Sites', async () => {
    const [result] = await Promise.all([
      reader.callTool({ name: 'read_page', arguments: { tabId: openedTabId } }),
      answerPrompt('Block this site'),
    ]);
    assert.match(textOf(result), /blocked localhost/);
    const tabs = textOf(await reader.callTool({ name: 'list_tabs', arguments: {} }));
    assert.match(tabs, new RegExp(`\\[${openedTabId}\\] \\(a site the user blocked for agents\\)`));
    await panel.getByRole('button', { name: 'Sites' }).click();
    await panel.getByRole('list', { name: 'Blocked' }).getByText('localhost').waitFor();
    await panel.getByRole('list', { name: 'Always allowed' }).getByText('127.0.0.1').waitFor();
    await panel.getByRole('button', { name: 'Sites' }).click();
    assert.match(textOf(await control.callTool({ name: 'close_tabs', arguments: { tabIds: [openedTabId] } })), /Closed 1 tab/);
  });

  console.log('Connect to Migma');
  const accountTab = await context.newPage();
  await accountTab.goto(`${siteC}/form.html`);

  await step('"Connect to Migma" connects in one click and closes the Migma tab', async () => {
    const opened = waitForPage('/connect/browser');
    await migmaCard.getByRole('button', { name: 'Connect to Migma' }).click();
    const connectTab = await opened;
    await connectTab.locator('#result').getByText('"connected":true').waitFor({ timeout: 10000 });
    assert.match(connectTab.url(), new RegExp(`tabpass=[A-Za-z0-9_-]{43}&ext=${extensionId}`));
    await connectTab.waitForEvent('close', { timeout: 5000 });
    await migmaCard.getByText('Connected as alice@example.com').waitFor();
    await migmaCard.getByRole('status').getByText('Connected').waitFor({ timeout: 10000 });
    assert.equal(relay.hub.stats().accounts, 1);
    assert.equal(relay.hub.stats().browsers, 1, 'the account shares the existing relay socket');
    if (screenshotDir) await panel.screenshot({ path: join(screenshotDir, 'panel-migma.png'), fullPage: true });
  });

  await step('Migma acts for that person only; site prompts name "Migma"; access starts at Read', async () => {
    const tabs = textOf(await migmaCall('user_alice', 'list_tabs'));
    const line = tabs.split('\n').find((entry) => entry.includes('127.0.0.2'));
    const tabId = Number(/\[(\d+)\]/.exec(line)[1]);
    const [result] = await Promise.all([
      migmaCall('user_alice', 'read_page', { tabId }),
      (async () => {
        const prompt = await waitForPage('prompt.html?id=');
        await prompt.getByRole('heading', { name: 'Allow Migma to use 127.0.0.2?' }).waitFor();
        await prompt.getByRole('button', { name: 'Allow for 10 min', exact: true }).click();
      })(),
    ]);
    assert.match(textOf(result), /Design forms that convert/);
    const click = await migmaCall('user_alice', 'click', { tabId, text: 'Sign up' });
    assert.match(textOf(click), /can only read/);
    assert.match(textOf(await migmaCall('user_bob', 'list_tabs')), /No browser is connected/, "a teammate's account never reaches Alice's browser");
    assert.match(textOf(await migmaCall('user_alice', 'list_browsers')), /^- Chrome on Linux \(default\)/);
  });

  await step('the activity names Migma and the client it came through', async () => {
    await panel.getByRole('button', { name: /^Activity/ }).click();
    await panel.getByRole('list', { name: 'Activity' }).getByText('Migma (Claude) · read page · 127.0.0.2').first().waitFor();
    await panel.getByRole('button', { name: /^Activity/ }).click();
  });

  await step('the Migma site can check the connection', async () => {
    const app = await context.newPage();
    await app.goto(`${providerUrl}/app?ext=${extensionId}`);
    await app.getByRole('button', { name: 'Check browser' }).click();
    await app.locator('#result').getByText('"connected":true').waitFor();
    const hello = JSON.parse(await app.locator('#result').textContent());
    assert.deepEqual(hello.account, { id: 'user_alice', email: 'alice@example.com', name: 'Alice' });
    assert.equal(hello.access, 'read');
    await app.close();
  });

  await step('"Use my browser" from the Migma app asks in Tabpass\'s own window first', async () => {
    const app = await context.newPage();
    await app.goto(`${providerUrl}/app?ext=${extensionId}&as=user_bob`);
    const promptOpened = waitForPage('prompt.html?connect=');
    await app.getByRole('button', { name: 'Use my browser' }).click();
    const confirm = await promptOpened;
    await confirm.getByRole('heading', { name: 'Connect this browser to Migma?' }).waitFor();
    await confirm.getByText('This replaces alice@example.com.').waitFor();
    if (screenshotDir) await confirm.screenshot({ path: join(screenshotDir, 'prompt-connect.png') });
    await confirm.getByRole('radio', { name: /Read and act/ }).click();
    await confirm.getByRole('button', { name: 'Connect', exact: true }).click();
    await app.locator('#result').getByText('"connected":true').waitFor();
    assert.match(await app.locator('#result').textContent(), /"access":"control"/);
    await migmaCard.getByText('Connected as bob@example.com').waitFor();
    await migmaCard.getByRole('status').getByText('Connected').waitFor({ timeout: 10000 });
    assert.match(textOf(await migmaCall('user_alice', 'list_tabs')), /No browser is connected/, 'the replaced account lost access');
    assert.ok(!(await migmaCall('user_bob', 'list_tabs')).isError);
    await app.close();
  });

  await step('a page cannot connect silently: cancel, a reused nonce, or a foreign relay all fail', async () => {
    const app = await context.newPage();
    await app.goto(`${providerUrl}/app?ext=${extensionId}&as=user_alice`);
    const promptOpened = waitForPage('prompt.html?connect=');
    await app.getByRole('button', { name: 'Use my browser' }).click();
    await (await promptOpened).getByRole('button', { name: 'Cancel', exact: true }).click();
    await app.locator('#result').getByText('"connected":false').waitFor();

    await app.getByRole('button', { name: 'Connect with another relay' }).click();
    await app.locator('#result').getByText('can only use its own relay').waitFor();
    await app.close();
    await migmaCard.getByText('Connected as bob@example.com').waitFor();
  });

  await step('revoking in Migma disconnects the browser and says so in the panel', async () => {
    const connectionId = [...connections.entries()].find(([, value]) => value.accountId === 'user_bob' && value.browserId)[0];
    connections.delete(connectionId); // the person removed it in Migma's settings
    const response = await fetch(`${relayHttp}/internal/connections/${connectionId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    assert.deepEqual(await response.json(), { revoked: 1 });
    await migmaCard.getByText('Migma disconnected this browser. Connect again to keep using it.').waitFor();
    await migmaCard.getByRole('button', { name: 'Connect to Migma' }).waitFor();
    assert.match(textOf(await migmaCall('user_bob', 'list_tabs')), /No browser is connected/);
  });

  await step('the Migma site can disconnect the browser, and the panel can too', async () => {
    const opened = waitForPage('/connect/browser');
    await migmaCard.getByRole('button', { name: 'Connect to Migma' }).click();
    await (await opened).waitForEvent('close', { timeout: 10000 });
    await migmaCard.getByText('Connected as alice@example.com').waitFor();

    const app = await context.newPage();
    await app.goto(`${providerUrl}/app?ext=${extensionId}`);
    await app.getByRole('button', { name: 'Disconnect browser' }).click();
    await app.locator('#result').getByText('"disconnected":true').waitFor();
    await app.close();
    await migmaCard.getByRole('button', { name: 'Connect to Migma' }).waitFor();

    const again = waitForPage('/connect/browser');
    await migmaCard.getByRole('button', { name: 'Connect to Migma' }).click();
    await (await again).waitForEvent('close', { timeout: 10000 });
    await migmaCard.getByRole('button', { name: 'Disconnect' }).click();
    await panel.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    await migmaCard.getByRole('button', { name: 'Connect to Migma' }).waitFor();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(relay.hub.stats().accounts, 0);
  });

  console.log('Safety switches');
  await step('pausing in the panel stops every call', async () => {
    await panel.getByRole('switch', { name: 'Let agents use this browser' }).click();
    await panel.locator('header').getByText('Paused').waitFor();
    const result = await control.callTool({ name: 'list_tabs', arguments: {} });
    assert.match(textOf(result), /paused/);
    await panel.getByRole('switch', { name: 'Let agents use this browser' }).click();
    assert.ok(!(await control.callTool({ name: 'list_tabs', arguments: {} })).isError);
  });

  await step('the panel fits its width in light and dark mode', async () => {
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (screenshotDir) {
      await panel.getByRole('button', { name: /^Activity/ }).click();
      await panel.screenshot({ path: join(screenshotDir, 'panel-activity.png'), fullPage: true });
      await panel.emulateMedia({ colorScheme: 'dark' });
      await new Promise((resolve) => setTimeout(resolve, 400)); // let color transitions finish
      await panel.screenshot({ path: join(screenshotDir, 'panel-dark.png') });
      await panel.emulateMedia({ colorScheme: 'light' });
      await panel.getByRole('button', { name: /^Activity/ }).click();
    }
  });

  await step('the extension reconnects after the relay restarts', async () => {
    relay.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    relay = startRelay();
    await relay.listen(relayPort, '127.0.0.1');
    const deadline = Date.now() + 15000;
    while (relay.hub.stats().browsers === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(relay.hub.stats().browsers, 1);
    assert.equal((await sessionState(`status:${relayWs}`)).state, 'connected');
    const fresh = await connectAgent(controlUrl);
    assert.ok(!(await fresh.callTool({ name: 'list_tabs', arguments: {} })).isError);
  });

  await step('disconnecting an agent in the panel revokes its link at once', async () => {
    const item = agentItem(panel, 'Researcher');
    const trigger = item.getByRole('button').first();
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await item.getByRole('button', { name: 'Disconnect' }).click();
    await panel.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    await item.waitFor({ state: 'detached' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await assert.rejects(connectAgent(readUrl), /401|not connected/);
  });
} catch {
  exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  await context.close();
  relay.close();
  fixtures.close();
  provider.close();
  await rm(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(exitCode || (failed ? 1 : 0));
