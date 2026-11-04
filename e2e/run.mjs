// End-to-end test: real Chromium with the built extension, the relay (OAuth on), MCP clients as AI
// tools, a third-party "AI site" speaking the Tabpass Web Protocol, and a fake Migma for the
// one-click account flow. Drives the side panel like a person would.
//
//   yarn --cwd connect build && yarn --cwd relay build && yarn --cwd extension build:dev && cd e2e && xvfb-run -a node run.mjs
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
const extensionPath = process.env.EXTENSION_PATH || join(here, '..', 'extension', 'dist');
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

// ---------- fixture sites ("127.0.0.1", "localhost", "tabpass.localhost") ----------

const fixtures = await serve(
  async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path === '/tabpass-connect.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(await readFile(join(here, '../connect/dist/index.js')));
        return;
      }
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
// A separate, unknown loopback origin without requiring an extra IP alias on macOS.
// The .localhost suffix preserves the fixture's secure context (crypto.randomUUID).
const siteC = `http://tabpass.localhost:${fixturePort}`;

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
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-proxy-server',
    '--host-resolver-rules=MAP tabpass.localhost 127.0.0.1',
  ],
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
  const migmaBanner = () => panel.getByRole('note').filter({ hasText: 'Migma detected' });
  const scrollScreen = async (bottom) => panel.evaluate((toBottom) => {
    let parent = document.querySelector('h1')?.parentElement;
    while (parent) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
        parent.scrollTop = toBottom ? parent.scrollHeight : 0;
        return parent.scrollTop > 0;
      }
      parent = parent.parentElement;
    }
    window.scrollTo(0, toBottom ? document.documentElement.scrollHeight : 0);
    return window.scrollY > 0;
  }, bottom);
  const assertBannerVisible = async () => {
    const viewport = panel.viewportSize();
    assert.ok(viewport, 'The side panel must have a viewport');
    // setViewportSize can resolve before the page handles the resize. A box from the old
    // smaller viewport can still fit inside the new one, so wait before comparing positions.
    await panel.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, viewport);
    await migmaBanner().getByRole('button', { name: 'Connect Migma', exact: true }).click({ trial: true });
    const box = await migmaBanner().boundingBox();
    assert.ok(box, 'The detected Migma banner must be visible');
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height + 1,
      `Migma banner must stay inside ${viewport.width}×${viewport.height}: ${JSON.stringify(box)}`);
    return box;
  };

  let controlUrl;
  let control;
  let formTabId;
  let detectedTab;

  console.log('Side panel');
  await step('first run explains what leaves the browser; the relay is set under Settings', async () => {
    await panel.getByRole('note').getByText('Give your AI access to your browser').waitFor();
    await panel.getByRole('note').getByText('Connected AI can see your tab titles and links. You approve each website before it can read pages or click and type.').waitFor();
    await shoot(panel, 'home-first-run.png');
    await panel.getByRole('button', { name: 'Got it' }).click();
    await panel.getByRole('button', { name: /Settings/ }).click();
    await panel.locator('#relay-url').fill(relayWs);
    await panel.locator('form', { has: panel.locator('#relay-url') }).getByRole('button', { name: 'Save' }).click();
    await panel.getByText(`Connected. AI tools reach this browser through 127.0.0.1:${relayPort}.`).waitFor({ timeout: 10000 });
    await back();
    await panel.getByRole('status').getByText('Browser online').waitFor();
    assert.equal((await relay.directory.stats()).browsers, 1);
  });

  await step('"App setup options" opens prompt-first setup and keeps the manual URL collapsed', async () => {
    await row('App setup options').click();
    await panel.waitForFunction(() => document.activeElement?.tagName === 'H1' && document.activeElement.textContent === 'Connect your AI');
    const serverUrl = panel.locator('code', { hasText: `${relayHttp}/mcp` }).first();
    assert.equal(await serverUrl.isVisible(), false, 'The raw server URL starts hidden under Manual setup');
    await shoot(panel, 'connect.png', { fullPage: true });
    await panel.getByText('Manual setup', { exact: true }).click();
    await panel.getByText('Server URL', { exact: true }).waitFor();
    await serverUrl.waitFor();
    await panel.getByText('Manual setup', { exact: true }).click();
    assert.equal(await serverUrl.isVisible(), false, 'Closing Manual setup hides the raw server URL again');
    await row('Claude').click();
    await panel.getByRole('button', { name: 'Add to Claude' }).waitFor();
    await panel.getByText('Claude cannot connect to a server running on your computer. Choose a public connection server in Settings.').waitFor();
    await shoot(panel, 'tool-claude.png', { fullPage: true });
    await back();
    await panel.waitForFunction(() => document.activeElement?.textContent === 'Connect your AI');
  });

  await step('exact https Migma detection stays visible below Home and the app list', async () => {
    const migmaFixture = (await readFile(join(here, 'fixtures', 'ai-site.html'), 'utf8')).replaceAll('Some AI tool', 'Migma');
    const serveMigmaFixture = async (route) => {
      const sdk = new URL(route.request().url()).pathname === '/tabpass-connect.js';
      await route.fulfill({
        status: 200,
        contentType: sdk ? 'text/javascript' : 'text/html',
        body: sdk ? await readFile(join(here, '../connect/dist/index.js')) : migmaFixture,
      });
    };
    await context.route('https://migma.ai/**', serveMigmaFixture);
    await context.route('https://migma.ai.evil.test/**', serveMigmaFixture);
    detectedTab = await context.newPage();
    await detectedTab.goto('https://migma.ai');
    await detectedTab.bringToFront();

    await back();
    await panel.getByRole('note').getByText('Migma detected', { exact: true }).waitFor();
    await panel.getByRole('note').getByText("Give Migma’s AI access to your browser.", { exact: true }).waitFor();
    await panel.getByRole('note').getByRole('button', { name: 'Connect Migma', exact: true }).waitFor();
    await panel.setViewportSize({ width: 320, height: 600 });
    await panel.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Migma suggestion overflows at 320px');
    const homeBanner = await assertBannerVisible();
    assert.equal(await scrollScreen(true), true, 'Home content must scroll in a short side panel');
    const scrolledHomeBanner = await assertBannerVisible();
    assert.ok(Math.abs(scrolledHomeBanner.y - homeBanner.y) <= 1,
      `The Migma banner must stay pinned while Home scrolls: ${JSON.stringify({ before: homeBanner, after: scrolledHomeBanner })}`);
    await scrollScreen(false);
    await shoot(panel, 'detected-migma-home-320.png');
    await row('App setup options').click();
    await panel.getByRole('note').getByText('Migma detected', { exact: true }).waitFor();
    await panel.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Migma Connect suggestion overflows at 320px');
    await panel.getByText('More tools', { exact: true }).click();
    for (const viewport of [{ width: 320, height: 600 }, { width: 380, height: 860 }]) {
      await panel.setViewportSize(viewport);
      await scrollScreen(false);
      const beforeScroll = await assertBannerVisible();
      assert.equal(await scrollScreen(true), true, 'The expanded app list must scroll');
      const afterScroll = await assertBannerVisible();
      assert.ok(Math.abs(afterScroll.y - beforeScroll.y) <= 1,
        `The Migma banner must stay pinned while the app list scrolls: ${JSON.stringify({ viewport, before: beforeScroll, after: afterScroll })}`);
      await shoot(panel, `detected-migma-connect-${viewport.width}.png`);
    }
    await panel.getByText('More tools', { exact: true }).click();
    await scrollScreen(false);
    await panel.setViewportSize({ width: 380, height: 860 });
    await panel.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await back();
    await assertBannerVisible();
    await panel.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await shoot(panel, 'detected-migma-home-dark-380.png');
    await panel.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  });

  await step('Connect Migma opens the exact setup link without granting access or changing the current tab', async () => {
    const originalUrl = detectedTab.url();
    const agentsBefore = await worker.evaluate(async () => ((await chrome.storage.local.get('agents')).agents ?? []).length);
    // Chromium can start chrome.tabs.create navigation before Playwright attaches its route.
    // Keep the real tab creation, but defer its first navigation until the fixture owns it.
    // Assert the unmodified URL requested by the UI as well as the resulting tab URL.
    await panel.evaluate(() => {
      const create = chrome.tabs.create.bind(chrome.tabs);
      window.requestedSetupUrl = null;
      chrome.tabs.create = (options) => {
        chrome.tabs.create = create;
        window.requestedSetupUrl = options.url;
        return create({ ...options, url: 'about:blank' });
      };
    });
    const failedRequests = [];
    const onRequestFailed = (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
    context.on('requestfailed', onRequestFailed);
    const opened = context.waitForEvent('page');
    await migmaBanner().getByRole('button', { name: 'Connect Migma', exact: true }).click();
    const setup = await opened;
    const requestedUrl = await panel.evaluate(() => window.requestedSetupUrl);
    assert.equal(requestedUrl, 'https://migma.ai/create?connector=tabpass');
    try {
      await setup.goto(requestedUrl);
      await setup.waitForURL('https://migma.ai/create?connector=tabpass');
    } catch (error) {
      const [title, body] = await Promise.allSettled([setup.title(), setup.locator('body').innerText({ timeout: 1000 })]);
      console.log('    Setup navigation diagnostics:', JSON.stringify({
        url: setup.url(),
        title: title.status === 'fulfilled' ? title.value : String(title.reason),
        body: body.status === 'fulfilled' ? body.value.slice(0, 500) : String(body.reason),
        pages: context.pages().map((page) => page.url()),
        failedRequests,
      }));
      throw error;
    } finally {
      context.off('requestfailed', onRequestFailed);
    }
    assert.equal(setup.url(), 'https://migma.ai/create?connector=tabpass');
    assert.equal(detectedTab.url(), originalUrl, 'Opening setup must preserve the current Migma page');
    assert.equal(await worker.evaluate(async () => ((await chrome.storage.local.get('agents')).agents ?? []).length), agentsBefore,
      'Opening setup must not create a browser grant');
    assert.equal(context.pages().filter((page) => page.url().includes('/prompt.html?agent=')).length, 0,
      'The website must ask for access from its own Connect browser button');
    await setup.close();
    await detectedTab.bringToFront();
    await migmaBanner().waitFor();
  });

  await step('switching away from Migma hides its banner and switching back restores it', async () => {
    const unrelatedTab = await context.newPage();
    await unrelatedTab.goto(`${siteA}/second.html`);
    await unrelatedTab.bringToFront();
    await migmaBanner().waitFor({ state: 'detached' });
    await detectedTab.bringToFront();
    await migmaBanner().waitFor();
    await unrelatedTab.close();
  });

  await step('Migma detection rejects a lookalike origin', async () => {
    await detectedTab.goto('https://migma.ai.evil.test');
    await detectedTab.bringToFront();
    await panel.getByRole('note').getByText('Migma detected', { exact: true }).waitFor({ state: 'detached' });
    await detectedTab.goto('https://migma.ai');
    await detectedTab.bringToFront();
    await panel.getByRole('note').getByText('Migma detected', { exact: true }).waitFor();
  });

  await step('approving Migma shows Connected immediately, before it uses any browser tool', async () => {
    const opened = waitForPage('prompt.html?agent=');
    await detectedTab.getByRole('button', { name: 'Connect your browser', exact: true }).click();
    const prompt = await opened;
    await prompt.getByRole('heading', { name: 'Connect Migma to your browser?', exact: true }).waitFor();
    await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
    await detectedTab.locator('#result').getByText('"token":"tp_').waitFor();
    await detectedTab.bringToFront();
    const approved = await worker.evaluate(async () => {
      const { agents = [] } = await chrome.storage.local.get('agents');
      const agent = agents.find((candidate) => candidate.origin === 'https://migma.ai');
      return agent ? { source: agent.source, lastUsedAt: agent.lastUsedAt } : null;
    });
    assert.deepEqual(approved, { source: 'web', lastUsedAt: null });
    await panel.getByRole('note', { name: /^Migma connected$/i }).waitFor();
    await panel.getByRole('note', { name: /^Migma connected$/i }).getByText('Can read pages you allow.', { exact: true }).waitFor();
    await region('Connected apps').getByRole('button', { name: 'Migma', exact: true }).getByText('Connected', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Connect Migma', exact: true }).count(), 0,
      'An approved website must not ask to connect again before its first tool call');
    await shoot(panel, 'migma-approved-before-first-use.png');
    await panel.getByRole('button', { name: 'Manage connection', exact: true }).click();
    await region('Connection').getByText('Connected', { exact: true }).waitFor();
    await panel.getByText('Access approved', { exact: true }).waitFor();
    await back();
  });

  await step('pausing an approved Migma grant updates the banner and saved app without asking to connect', async () => {
    await panel.getByRole('switch', { name: 'Allow AI access' }).click();
    await panel.getByRole('note', { name: /^Migma paused$/i }).waitFor();
    await region('Connected apps').getByRole('button', { name: 'Migma', exact: true }).getByText('Paused', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Manage connection', exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Connect Migma', exact: true }).count(), 0);
    await panel.getByRole('switch', { name: 'Allow AI access' }).click();
    await panel.getByRole('note', { name: /^Migma connected$/i }).waitFor();
    await region('Connected apps').getByRole('button', { name: 'Migma', exact: true }).getByText('Connected', { exact: true }).waitFor();
  });

  await step('an approved but unused Migma grant survives relay loss and reports offline truthfully', async () => {
    relay.close();
    await panel.getByRole('note', { name: /^Migma connecting…$/i }).waitFor();
    await region('Connected apps').getByRole('button', { name: 'Migma', exact: true }).getByText('Connecting…', { exact: true }).waitFor();
    // A socket close retries as "connecting". Exercise the separate terminal-error display
    // using only this disposable profile, then let a real relay welcome restore the status.
    await worker.evaluate(async (url) => {
      const key = `status:${url}`;
      const current = (await chrome.storage.session.get(key))[key];
      await chrome.storage.session.set({ [key]: { ...current, state: 'error', message: 'Fixture relay unavailable' } });
    }, relayWs);
    await panel.getByRole('note', { name: /^Migma offline$/i }).waitFor();
    await region('Connected apps').getByRole('button', { name: 'Migma', exact: true }).getByText('Offline', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Manage connection', exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Connect Migma', exact: true }).count(), 0);
    relay = startRelay();
    await relay.listen(relayPort, '127.0.0.1');
    await panel.getByRole('note', { name: /^Migma connected$/i }).waitFor({ timeout: 15000 });
    const lastUsedAt = await worker.evaluate(async () => {
      const { agents = [] } = await chrome.storage.local.get('agents');
      return agents.find((candidate) => candidate.origin === 'https://migma.ai')?.lastUsedAt;
    });
    assert.equal(lastUsedAt, null, 'Reconnecting must not require a first browser tool call');
    await panel.getByRole('button', { name: 'Manage connection', exact: true }).click();
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await panel.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await migmaBanner().waitFor();
    await panel.getByRole('button', { name: 'Connect Migma', exact: true }).waitFor();
  });

  await step('a used web grant named Migma from another origin cannot hide the real Migma connection prompt', async () => {
    const otherOrigin = await context.newPage();
    await otherOrigin.goto('https://migma.ai.evil.test');
    const opened = waitForPage('prompt.html?agent=');
    await otherOrigin.getByRole('button', { name: 'Connect your browser', exact: true }).click();
    await (await opened).getByRole('button', { name: 'Connect', exact: true }).click();
    await otherOrigin.locator('#result').getByText('"token":"tp_').waitFor();
    const { connectorUrl } = JSON.parse(await otherOrigin.locator('#result').textContent());
    const misnamed = await connectAgent(connectorUrl);
    assert.ok(!(await misnamed.callTool({ name: 'list_tabs', arguments: {} })).isError);
    await detectedTab.bringToFront();
    await migmaBanner().waitFor();
    await panel.getByRole('button', { name: 'Connect Migma', exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Manage connection', exact: true }).count(), 0,
      'A web grant must match the active origin, even when its label and use history match');
    await region('Connected apps').getByRole('button', { name: 'Migma', exact: true }).click();
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await panel.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await migmaBanner().waitFor();
    await otherOrigin.close();
  });

  await step('an unused manual Migma link stays in setup state and does not hide detection', async () => {
    await row('App setup options').click();
    await panel.getByRole('note').getByText('Migma detected', { exact: true }).waitFor();
    await row('Create connection prompt').click();
    await panel.locator('#agent-name').fill('Migma.ai MCP Client - Tabpass');
    await panel.getByRole('button', { name: 'Create connection prompt', exact: true }).click();
    await panel.getByText('Connection link created · Set up', { exact: true }).waitFor();
    await panel.getByText('Waiting for AI setup', { exact: true }).waitFor();
    await panel.locator('img[src$="/icons/clients/migma.svg"]').waitFor();
    await row('Copy connection prompt').waitFor();
    await panel.getByText('This server runs on your computer. Cloud AI apps cannot reach it; use a public server in Settings.', { exact: false }).waitFor();
    const advanced = panel.locator('details', { hasText: 'Advanced setup' });
    assert.equal(await advanced.getAttribute('open'), null, 'Advanced setup starts collapsed');
    assert.equal(await advanced.locator('code').first().isVisible(), false, 'The private server URL starts hidden');
    assert.equal(await advanced.getByText('Header', { exact: true }).isVisible(), false, 'Advanced header starts hidden');
    assert.equal(await advanced.getByText('MCP config', { exact: true }).isVisible(), false, 'Advanced config starts hidden');
    await shoot(panel, 'manual-migma-waiting.png', { fullPage: true });
    await advanced.locator('summary').click();
    const manualMigmaUrl = await advanced.locator('code').first().textContent();
    await advanced.locator('summary').click();
    await back();
    await back();
    await panel.getByRole('note').getByText('Migma detected', { exact: true }).waitFor();
    await region('Connected apps').getByRole('button', { name: 'Migma.ai MCP Client - Tabpass', exact: true }).getByText('Set up', { exact: true }).waitFor();
    const manualMigma = await connectAgent(manualMigmaUrl);
    assert.ok(!(await manualMigma.callTool({ name: 'list_tabs', arguments: {} })).isError);
    await panel.getByRole('note').getByText('Migma detected', { exact: true }).waitFor({ state: 'detached' });
    await panel.getByRole('note', { name: /^Migma connected$/i }).waitFor();
    await row('Migma.ai MCP Client - Tabpass').click();
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await panel.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await detectedTab.close();
    await row('App setup options').click();
  });

  await step('a private connection prompt starts at My AI and Read and can be raised', async () => {
    await row('Create connection prompt').click();
    assert.equal(await panel.locator('#agent-name').inputValue(), 'My AI');
    assert.equal(await panel.getByRole('radio', { name: 'Read', exact: true }).getAttribute('aria-checked'), 'true');
    await panel.getByRole('button', { name: 'Claude', exact: true }).click();
    assert.equal(await panel.getByRole('radio', { name: 'Read', exact: true }).getAttribute('aria-checked'), 'true');
    await panel.getByRole('radio', { name: 'Read', exact: true }).focus();
    // Radix selects on deferred focus while the physical arrow key remains down.
    await panel.keyboard.press('ArrowRight', { delay: 50 });
    await panel.waitForFunction(() => [...document.querySelectorAll('[role="radio"]')].some((radio) => radio.textContent === 'Read and act' && radio.getAttribute('aria-checked') === 'true'));
    assert.equal(await panel.getByRole('radio', { name: 'Read and act' }).getAttribute('aria-checked'), 'true');
    await panel.getByRole('button', { name: 'Create connection prompt', exact: true }).click();
    await panel.waitForFunction(() => document.activeElement?.tagName === 'H1' && document.activeElement.textContent === 'Claude');
    await row('Copy connection prompt').waitFor();
    await panel.getByText('This server runs on your computer. Cloud AI apps cannot reach it; use a public server in Settings.', { exact: false }).waitFor();
    const advanced = panel.locator('details', { hasText: 'Advanced setup' });
    const code = advanced.locator('code').first();
    assert.equal(await code.isVisible(), false, 'The private server URL starts hidden until Advanced setup is opened');
    // Use the real Clipboard API under the click's user activation; a failed write must fail the test.
    await panel.bringToFront();
    await row('Copy connection prompt').click();
    await panel.getByRole('status').getByText('Copied. Paste it into your AI when the browser is online.', { exact: true }).waitFor();
    await advanced.locator('summary').click();
    await code.waitFor();
    controlUrl = await code.textContent();
    await advanced.locator('summary').click();
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

  await step('page evidence includes real pixels, design and bounded clean HTML', async () => {
    await userTab.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.id = 'evidence-test';
      fixture.setAttribute('data-private', 'APP_STATE_SECRET');
      fixture.innerHTML = '<h2>Evidence structure</h2><p hidden>HIDDEN_SECRET</p><input type="password" value="PASSWORD_SECRET"><div contenteditable="true">UNSENT_DRAFT_SECRET</div><a href="/second.html" onclick="void(0)">Safe destination</a>';
      document.body.appendChild(fixture);
    });
    const result = await control.callTool({ name: 'read_page', arguments: {
      tabId: formTabId, includeVisuals: true, includeHtml: true,
    } });
    assert.notEqual(result.isError, true, textOf(result));
    const evidence = JSON.parse(result.content[0].text);
    assert.equal(evidence.kind, 'tabpass.page');
    assert.equal(evidence.url, `${siteA}/form.html`);
    assert.match(evidence.text, /Design forms that convert/);
    assert.match(evidence.html, /<h1>Design forms that convert<\/h1>/);
    assert.match(evidence.html, /<h2>Evidence structure<\/h2>/);
    assert.match(evidence.html, /<table>/);
    assert.ok(evidence.html.includes(`${siteA}/second.html`));
    assert.doesNotMatch(evidence.html, /<script|<input|onclick|APP_STATE_SECRET|HIDDEN_SECRET|PASSWORD_SECRET|UNSENT_DRAFT_SECRET/);
    assert.equal(evidence.design.url, evidence.url);
    assert.equal(evidence.design.colors.pageBackground, '#fdf6ec');
    const pixels = result.content.find(item => item.type === 'image');
    assert.equal(pixels?.mimeType, 'image/jpeg');
    assert.ok(pixels.data.length > 1000, 'actual Chromium screenshot pixels traverse MCP');
    await userTab.evaluate(() => {
      document.getElementById('evidence-test').innerHTML = '<p>Large source fragment</p>'.repeat(900);
    });
    const bounded = JSON.parse(textOf(await control.callTool({ name: 'read_page', arguments: { tabId: formTabId, includeHtml: true } })));
    assert.ok(bounded.html.length <= 12000);
    assert.equal(bounded.htmlTruncated, true);
    await userTab.evaluate(() => document.getElementById('evidence-test').remove());
  });

  await step('display:contents wrappers preserve product evidence and keep HTML free of form values', async () => {
    const productTab = await context.newPage();
    await productTab.goto(`${siteA}/display-contents.html`);
    const tabs = textOf(await control.callTool({ name: 'list_tabs', arguments: {} }));
    const productTabId = Number(/\[(\d+)\] Display Contents Product/.exec(tabs)?.[1]);
    assert.ok(Number.isInteger(productTabId), 'the display:contents fixture tab is listed');
    const result = await control.callTool({ name: 'read_page', arguments: { tabId: productTabId, includeHtml: true } });
    assert.notEqual(result.isError, true, textOf(result));
    const evidence = JSON.parse(result.content[0].text);
    assert.match(evidence.text, /Trail Runner in Glacier Blue/);
    assert.match(evidence.text, /110,00 €/);
    assert.match(evidence.text, /Lightweight everyday trainers/);
    assert.match(evidence.html, /<h1>Trail Runner in Glacier Blue<\/h1>/);
    for (const photo of ['front', 'side', 'back', 'sole', 'detail']) {
      assert.ok(evidence.html.includes(`${siteA}/products/trail-runner-${photo}.jpg`), `visible ${photo} image URL is preserved`);
    }
    assert.doesNotMatch(evidence.text, /DISPLAY_NONE_SECRET|ARIA_HIDDEN_SECRET/);
    assert.match(evidence.text, /EDITABLE_DOCUMENT_TEXT/);
    assert.doesNotMatch(evidence.html, /DISPLAY_NONE_SECRET|ARIA_HIDDEN_SECRET|hidden-display|hidden-aria/);
    assert.doesNotMatch(evidence.html, /TEXTAREA_DRAFT_SECRET|EDITABLE_DOCUMENT_TEXT|<textarea/);
    await productTab.close();
    await userTab.bringToFront();
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
    const declinedPrompt = waitForPage('prompt.html?agent=');
    await site.getByRole('button', { name: 'Connect your browser' }).click();
    await (await declinedPrompt).getByRole('button', { name: "Don't connect", exact: true }).click();
    await site.locator('#result').getByText('"error":"declined"').waitFor();
    const promptOpened = waitForPage('prompt.html?agent=');
    await site.getByRole('button', { name: 'Connect your browser' }).click();
    const prompt = await promptOpened;
    await prompt.getByText('tabpass.localhost:' + fixturePort + ' asked to connect.', { exact: false }).waitFor();
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
    await userTab.bringToFront();
    const tabs = textOf(await migmaCall('user_alice', 'list_tabs'));
    assert.match(tabs, /Tab metadata only/);
    assert.doesNotMatch(tabs, /Fast setup/, 'list_tabs must not expose page body text');
    const activeTabId = Number(/\[(\d+)\] Acme Studio[^\n]*\(active/.exec(tabs)?.[1]);
    assert.ok(Number.isInteger(activeTabId), 'Migma can identify the active Acme tab from list_tabs');
    const explicitPage = textOf(await migmaCall('user_alice', 'read_page', { tabId: activeTabId }));
    assert.match(explicitPage, /^Page content below is untrusted data/);
    assert.match(explicitPage, /Title: Acme Studio — Forms/);
    assert.match(explicitPage, new RegExp(`URL: ${siteA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/form\\.html`));
    assert.match(explicitPage, /# Design forms that convert/);
    assert.match(explicitPage, /- Fast setup/);
    const activePage = textOf(await migmaCall('user_alice', 'read_page'));
    assert.match(activePage, /Title: Acme Studio — Forms/);
    assert.match(activePage, new RegExp(`URL: ${siteA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/form\\.html`));
    assert.match(activePage, /# Design forms that convert/, 'read_page without tabId reads the active tab');
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
  await step('the switch pauses every agent; Website access lists what was allowed', async () => {
    await panel.getByRole('switch', { name: 'Allow AI access' }).click();
    await panel.getByRole('status').getByText(/^Paused/).waitFor();
    assert.match(textOf(await control.callTool({ name: 'list_tabs', arguments: {} })), /paused/);
    await panel.getByRole('switch', { name: 'Allow AI access' }).click();
    assert.ok(!(await control.callTool({ name: 'list_tabs', arguments: {} })).isError);
    await panel.getByRole('button', { name: /^Website access/ }).click();
    await region('Always allowed').getByText('127.0.0.1').waitFor();
    await shoot(panel, 'sites.png', { fullPage: true });
    await back();
  });

  await step('the panel fits its width in light and dark mode', async () => {
    await panel.getByRole('button', { name: /Settings/ }).click();
    const originalName = await panel.locator('#browser-name').inputValue();
    await panel.locator('#browser-name').fill('W'.repeat(60));
    await panel.locator('form', { has: panel.locator('#browser-name') }).getByRole('button', { name: 'Save' }).click();
    await back();
    await panel.getByRole('status').getByText('Browser online').waitFor();
    for (const colorScheme of ['light', 'dark']) {
      await panel.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      for (const width of [320, 380]) {
        await panel.setViewportSize({ width, height: 860 });
        assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Home overflow at ${width}px in ${colorScheme}`);
        await shoot(panel, `home-${colorScheme}-${width}.png`, { fullPage: true });
        await row('App setup options').click();
        assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Connect overflow at ${width}px in ${colorScheme}`);
        await shoot(panel, `connect-${colorScheme}-${width}.png`, { fullPage: true });
        await back();
      }
    }
    await panel.getByRole('button', { name: /Settings/ }).click();
    await panel.locator('#browser-name').fill(originalName);
    await panel.locator('form', { has: panel.locator('#browser-name') }).getByRole('button', { name: 'Save' }).click();
    await back();
    await panel.setViewportSize({ width: 380, height: 860 });
    await panel.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
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
    await panel.getByRole('alertdialog').waitFor();
    await panel.keyboard.press('Escape');
    await panel.getByRole('alertdialog').waitFor({ state: 'detached' });
    await panel.waitForFunction(() => document.activeElement?.textContent === 'Disconnect');
    assert.ok(!(await control.callTool({ name: 'list_tabs', arguments: {} })).isError, 'Escape must preserve the connected tool');
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await panel.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    await row('Claude').waitFor({ state: 'detached' });
    await sleep(200);
    await assert.rejects(connectAgent(controlUrl), /401|was removed/);
  });
  await step('SDK reports relay unavailable instead of connected when the relay is offline', async () => {
    relay.close();
    const site = await context.newPage();
    await site.goto(`${siteC}/ai-site.html`);
    const opened = waitForPage('prompt.html?agent=');
    await site.getByRole('button', { name: 'Connect your browser' }).click();
    await (await opened).getByRole('button', { name: 'Connect', exact: true }).click();
    await site.locator('#result').getByText('"error":"relay_unavailable"').waitFor({ timeout: 15000 });
    await site.close();
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
