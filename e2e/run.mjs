// End-to-end test: real Chromium with the unpacked extension, the relay, and an MCP client acting
// as the AI agent. Drives the side panel UI like a person would.
//
//   cd relay && yarn build && cd ../e2e && xvfb-run -a node run.mjs
//
// SCREENSHOT_DIR=/some/dir saves side-panel and prompt screenshots for a visual check.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium } from 'playwright';

import { createRelayServer } from '../relay/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(here, '..', 'extension');
const screenshotDir = process.env.SCREENSHOT_DIR;
const executablePath = process.env.CHROMIUM_PATH || undefined;

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

// ---------- fixture site ----------

const fixtures = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = path === '/' ? 'form.html' : path.slice(1);
  try {
    const body = await readFile(join(here, 'fixtures', file));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => fixtures.listen(0, '127.0.0.1', resolve));
const fixturePort = fixtures.address().port;
const siteA = `http://127.0.0.1:${fixturePort}`; // site "127.0.0.1"
const siteB = `http://localhost:${fixturePort}`; // site "localhost"

// ---------- relay ----------

let relay = createRelayServer({ publicUrl: 'http://127.0.0.1:0', log: () => undefined });
let relayPort = await relay.listen(0, '127.0.0.1');
relay.close();
relay = createRelayServer({ publicUrl: `http://127.0.0.1:${relayPort}`, log: () => undefined });
await relay.listen(relayPort, '127.0.0.1');
const relayWs = `ws://127.0.0.1:${relayPort}/extension`;

// ---------- browser ----------

const userDataDir = await mkdtemp(join(tmpdir(), 'migma-tabs-e2e-'));
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

/** The side-panel row of one agent, matched by its name only (row text also contains "migma-tabs"). */
function agentRow(panel, name) {
  return panel.locator('.agent').filter({ has: panel.locator('.name', { hasText: new RegExp(`^${name}$`) }) });
}

async function answerPrompt(buttonText) {
  const prompt = await context.waitForEvent('page', { predicate: (page) => page.url().includes('prompt.html'), timeout: 15000 });
  await prompt.waitForLoadState('domcontentloaded');
  await prompt.getByRole('button', { name: buttonText, exact: true }).waitFor();
  if (screenshotDir && buttonText === 'Always allow') await prompt.screenshot({ path: join(screenshotDir, 'prompt.png') });
  await prompt.getByRole('button', { name: buttonText, exact: true }).click();
  return prompt;
}

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const sessionState = (key) => worker.evaluate(async (k) => (await chrome.storage.session.get(k))[k], key);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);

  let controlUrl;
  let readUrl;
  let control;
  let reader;
  let formTabId;

  console.log('Side panel');
  await step('relay address is saved from the panel and the browser connects', async () => {
    await panel.locator('#relay-block > summary').click();
    await panel.locator('#relay-input').fill(relayWs);
    await panel.getByRole('button', { name: 'Save' }).click();
    await panel.locator('#status').getByText('Connected').waitFor({ timeout: 10000 });
    assert.equal(relay.hub.stats().browsers, 1);
  });

  await step('connecting an agent with "Read and act" shows its connector URL', async () => {
    await panel.getByRole('button', { name: 'Connect an agent' }).click();
    await panel.getByRole('button', { name: 'Claude', exact: true }).click();
    await panel.locator('label', { hasText: 'Read and act' }).click();
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    const code = panel.locator('.agent .details code').first();
    await code.waitFor();
    controlUrl = await code.textContent();
    assert.match(controlUrl, new RegExp(`^http://127\\.0\\.0\\.1:${relayPort}/mcp/mtb_[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{43}$`));
    if (screenshotDir) await panel.screenshot({ path: join(screenshotDir, 'panel-agent.png'), fullPage: true });
  });

  await step('a second, read-only agent can be added', async () => {
    await panel.getByRole('button', { name: 'Connect an agent' }).click();
    await panel.locator('#agent-name').fill('Migma');
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await agentRow(panel, 'Migma').locator('.details code').waitFor();
    readUrl = await agentRow(panel, 'Migma').locator('.details code').textContent();
    assert.notEqual(readUrl, controlUrl);
  });

  console.log('Reading');
  const userTab = await context.newPage();
  await userTab.goto(`${siteA}/form.html`);
  await userTab.bringToFront();

  await step('control agent sees all 15 tools; read agent sees the 6 read tools', async () => {
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
    assert.match(line, /\(active/);
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
    assert.match(text, /## Why teams pick Acme/);
    assert.match(text, /- Fast setup/);
    assert.match(text, /  - Nested item/);
    assert.match(text, /\| Plan \| Price \|/);
    assert.match(text, /\[Read the guide\]\(http:\/\/127\.0\.0\.1:\d+\/second\.html\)/);
    assert.match(text, /Footer line/);
  });

  await step('the read-only agent reads the allowed site without a prompt', async () => {
    const result = await reader.callTool({ name: 'read_page', arguments: { tabId: formTabId, maxChars: 1000 } });
    assert.ok(!result.isError, textOf(result));
    assert.match(textOf(result), /Design forms that convert/);
  });

  await step('get_selection returns highlighted text', async () => {
    await userTab.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('quote'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    const text = textOf(await reader.callTool({ name: 'get_selection', arguments: { tabId: formTabId } }));
    assert.match(text, /Highlighted text:\nHighlight this sentence please\./);
  });

  await step('extract_design reports palette, fonts, buttons, radii and logo', async () => {
    const text = textOf(await reader.callTool({ name: 'extract_design', arguments: { tabId: formTabId } }));
    const design = JSON.parse(text.slice(text.indexOf('{')));
    assert.equal(design.themeColor, '#ff5a1f');
    assert.equal(design.colors.pageBackground, '#fdf6ec');
    assert.ok(design.colors.accents.some((color) => color.value === '#ff5a1f'), JSON.stringify(design.colors));
    assert.ok(design.fonts.some((font) => /Georgia/.test(font.value)), JSON.stringify(design.fonts));
    assert.match(design.typeScale.h1.fontFamily, /Trebuchet/);
    assert.equal(design.typeScale.h1.fontSize, '40px');
    const cta = design.buttons.find((button) => button.text === 'Sign up');
    assert.ok(cta, JSON.stringify(design.buttons));
    assert.equal(cta.background, '#ff5a1f');
    assert.equal(cta.radius, '12px');
    assert.ok(design.radii.some((radius) => radius.value === '16px'));
    assert.equal(design.logo.alt, 'Acme logo');
    assert.ok(design.contentWidth.includes('720px'), JSON.stringify(design.contentWidth));
  });

  await step('screenshot returns a JPEG image', async () => {
    const result = await reader.callTool({ name: 'screenshot', arguments: { tabId: formTabId } });
    const image = result.content.find((item) => item.type === 'image');
    assert.ok(image, textOf(result));
    assert.equal(image.mimeType, 'image/jpeg');
    assert.ok(Buffer.from(image.data, 'base64').length > 5000);
  });

  await step('read-only agents cannot call control tools', async () => {
    const result = await reader.callTool({ name: 'click', arguments: { tabId: formTabId, text: 'Sign up' } });
    assert.equal(result.isError, true);
  });

  console.log('Acting');
  let refs;
  await step('read_page interactive=true lists fields and buttons with refs', async () => {
    const text = textOf(await control.callTool({ name: 'read_page', arguments: { tabId: formTabId, interactive: true } }));
    const ref = (pattern) => Number(new RegExp(`\\[ref=(\\d+)\\] ${pattern}`).exec(text)?.[1]);
    refs = {
      name: ref('textbox "Your name"'),
      plan: ref('select "Plan"'),
      signUp: ref('button "Sign up"'),
      search: ref('textbox "Search"'),
      controlled: ref('textbox "Controlled"'),
      notes: ref('textbox "Notes"'),
    };
    for (const [key, value] of Object.entries(refs)) assert.ok(Number.isInteger(value), `${key} ref missing in:\n${text}`);
    assert.match(text, /select "Plan" selected="Free" options=\["Free","Pro"\]/);
  });

  await step('type and click fill and submit a form', async () => {
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: refs.name, text: 'Ada' } });
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: refs.plan, text: 'Pro' } });
    const clicked = await control.callTool({ name: 'click', arguments: { tabId: formTabId, ref: refs.signUp } });
    assert.match(textOf(clicked), /Clicked \[ref=\d+\] button "Sign up"/);
    assert.equal(await userTab.locator('#result').textContent(), 'Thanks, Ada (pro)!');
  });

  await step('typing into a React-style controlled input updates its state', async () => {
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: refs.controlled, text: 'hello' } });
    assert.equal(await userTab.locator('#controlled-out').textContent(), 'State: hello');
  });

  await step('typing into a rich-text editor works', async () => {
    await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: refs.notes, text: 'Brief for Migma' } });
    assert.equal(await userTab.locator('#notes').textContent(), 'Brief for Migma');
  });

  await step('press_key sends Escape to the page', async () => {
    const result = await control.callTool({ name: 'press_key', arguments: { tabId: formTabId, key: 'Escape' } });
    assert.ok(!result.isError, textOf(result));
    assert.equal(await userTab.locator('#result').textContent(), 'Escaped');
  });

  await step('scroll moves the page and reports the bottom', async () => {
    const text = textOf(await control.callTool({ name: 'scroll', arguments: { tabId: formTabId, direction: 'bottom' } }));
    assert.match(text, /bottom of the page/);
    assert.ok((await userTab.evaluate(() => scrollY)) > 1000);
  });

  await step('type with submit=true submits a search form and waits for the next page', async () => {
    const result = await control.callTool({ name: 'type', arguments: { tabId: formTabId, ref: refs.search, text: 'brand kits', submit: true } });
    assert.match(textOf(result), /Now: Second page — http:\/\/127\.0\.0\.1:\d+\/second\.html\?q=brand\+kits/);
    const text = textOf(await control.callTool({ name: 'wait_for', arguments: { tabId: formTabId, text: 'You searched for' } }));
    assert.match(text, /is on the page/);
  });

  await step('click by visible text follows a link; navigate back returns', async () => {
    const clicked = await control.callTool({ name: 'click', arguments: { tabId: formTabId, text: 'Back to form' } });
    assert.match(textOf(clicked), /Now: Acme Studio — Forms/);
    const back = await control.callTool({ name: 'navigate', arguments: { tabId: formTabId, action: 'back' } });
    assert.match(textOf(back), /Second page/);
  });

  await step('a stale ref gives a clear error after the page changed', async () => {
    const result = await control.callTool({ name: 'click', arguments: { tabId: formTabId, ref: refs.signUp } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /ref \d+ is gone|did not respond|Could not reach/);
  });

  console.log('Tabs and sites');
  let openedTabId;
  await step('open_tab on a new site: "Decline" returns an error the agent can read', async () => {
    const [result] = await Promise.all([
      control.callTool({ name: 'open_tab', arguments: { url: `${siteB}/second.html` } }),
      answerPrompt('Decline'),
    ]);
    assert.equal(result.isError, true);
    assert.match(textOf(result), /declined access to localhost/);
  });

  await step('open_tab with "Allow for 10 min" opens the tab in the agent\'s tab group', async () => {
    const [result] = await Promise.all([
      control.callTool({ name: 'open_tab', arguments: { url: `${siteB}/second.html` } }),
      answerPrompt('Allow for 10 min'),
    ]);
    const text = textOf(result);
    assert.match(text, /^Opened tab (\d+): Second page/);
    openedTabId = Number(/^Opened tab (\d+)/.exec(text)[1]);
    const group = await worker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id);
      return chrome.tabGroups.get(tab.groupId);
    }, openedTabId);
    assert.equal(group.title, 'Claude');
    assert.equal(group.color, 'blue');
    // The temporary grant covers the next call without a prompt.
    assert.match(textOf(await control.callTool({ name: 'read_page', arguments: { tabId: openedTabId } })), /Second page/);
  });

  await step('the grant is per agent: blocking the site hides it from list_tabs', async () => {
    const [result] = await Promise.all([
      reader.callTool({ name: 'read_page', arguments: { tabId: openedTabId } }),
      answerPrompt('Block this site'),
    ]);
    assert.equal(result.isError, true);
    assert.match(textOf(result), /blocked localhost/);
    const tabs = textOf(await reader.callTool({ name: 'list_tabs', arguments: {} }));
    assert.match(tabs, new RegExp(`\\[${openedTabId}\\] \\(a site the user blocked for agents\\)`));
    assert.doesNotMatch(tabs, /localhost/);
    await panel.locator('summary', { hasText: 'Sites' }).click();
    await panel.locator('#blocked-sites').getByText('localhost').waitFor();
    await panel.locator('#allowed-sites').getByText('127.0.0.1').waitFor();
  });

  await step('group_tabs names and colors a group; close_tabs closes the agent\'s own tab', async () => {
    const grouped = await control.callTool({ name: 'group_tabs', arguments: { tabIds: [formTabId], title: 'Research', color: 'green' } });
    assert.match(textOf(grouped), /Grouped 1 tab into "Research" \(green\)/);
    // Its own group closes without a prompt even though the site is now blocked.
    const closed = await control.callTool({ name: 'close_tabs', arguments: { tabIds: [openedTabId] } });
    assert.match(textOf(closed), new RegExp(`Closed 1 tab: ${openedTabId}`));
  });

  console.log('Safety switches');
  await step('pausing in the panel stops every call', async () => {
    await panel.locator('#enabled').uncheck();
    await panel.locator('#status').getByText('Paused').waitFor();
    const result = await control.callTool({ name: 'list_tabs', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /paused/);
    await panel.locator('#enabled').check();
    assert.ok(!(await control.callTool({ name: 'list_tabs', arguments: {} })).isError);
  });

  await step('activity shows what agents did, including failures', async () => {
    await panel.locator('#activity-block > summary').click();
    await panel.locator('#activity').getByText('Claude · read page · 127.0.0.1').first().waitFor();
    await panel.locator('#activity').getByText(/declined access to localhost/).first().waitFor();
    if (screenshotDir) {
      await panel.screenshot({ path: join(screenshotDir, 'panel-activity.png'), fullPage: true });
      await panel.emulateMedia({ colorScheme: 'dark' });
      await panel.screenshot({ path: join(screenshotDir, 'panel-dark.png') });
      await panel.emulateMedia({ colorScheme: 'light' });
    }
    // Nothing in the panel may be wider than the side panel itself.
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });

  await step('the extension reconnects after the relay restarts', async () => {
    relay.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    relay = createRelayServer({ publicUrl: `http://127.0.0.1:${relayPort}`, log: () => undefined });
    await relay.listen(relayPort, '127.0.0.1');
    const deadline = Date.now() + 15000;
    while (relay.hub.stats().browsers === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(relay.hub.stats().browsers, 1);
    assert.equal((await sessionState('status')).state, 'connected');
    const fresh = await connectAgent(controlUrl);
    assert.ok(!(await fresh.callTool({ name: 'list_tabs', arguments: {} })).isError);
  });

  await step('disconnecting an agent in the panel revokes its token at once', async () => {
    panel.once('dialog', (dialog) => dialog.accept());
    const row = agentRow(panel, 'Migma').locator('button.row');
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
    await agentRow(panel, 'Migma').getByRole('button', { name: 'Disconnect' }).click();
    await agentRow(panel, 'Migma').waitFor({ state: 'detached' });
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
  await rm(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(exitCode || (failed ? 1 : 0));
