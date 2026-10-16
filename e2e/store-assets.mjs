// Makes the Chrome Web Store images from the production build, driven like a person would:
//
//   yarn --cwd relay build && cd e2e && xvfb-run -a node store-assets.mjs
//
// It builds the extension in production mode into a temporary folder, serves the relay as
// https://tabs.migma.ai and two made-up sites (northwind.studio, chatgpt.com) from this machine
// over HTTPS (a throwaway certificate; Chrome's host rules point the names here), connects three
// AI tools, and photographs the real side panel and prompts. Nothing goes to the internet.
//
// Writes store/images/: five 1280x800 screenshots, the 440x280 small tile and the 1400x560 marquee.
// RAW_DIR=/some/dir also keeps the raw shots.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium } from 'playwright';

import { createRelay } from '../relay/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'store', 'images');
const work = await mkdtemp(join(tmpdir(), 'tabpass-store-'));
const raw = process.env.RAW_DIR ?? join(work, 'raw');
await mkdir(raw, { recursive: true });
await mkdir(out, { recursive: true });

const RELAY_HOST = 'tabs.migma.ai';
const SITE_HOST = 'northwind.studio';
const CHATGPT_HOST = 'chatgpt.com';
const CHATGPT_REDIRECT = `https://${CHATGPT_HOST}/connector_platform_oauth_redirect`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (result) => result.content.map((item) => item.text ?? '').join('\n');
const listen = (server, port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));

// ---------- production build and a throwaway certificate ----------

const extensionPath = join(work, 'extension');
execFileSync('npx', ['vite', 'build', '--outDir', extensionPath, '--logLevel', 'warn'], { cwd: join(root, 'extension'), stdio: 'inherit' });
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=tabpass-store',
  '-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem'),
  '-addext', `subjectAltName=DNS:${RELAY_HOST},DNS:${SITE_HOST},DNS:${CHATGPT_HOST}`,
], { stdio: 'ignore' });

// ---------- one HTTPS server for the three names; the relay also on plain HTTP for the agents ----------

const relay = createRelay({ publicUrl: `https://${RELAY_HOST}`, secret: randomBytes(32).toString('hex'), log: () => undefined });
const northwind = await readFile(join(here, 'fixtures', 'store', 'northwind.html'));
const https = createHttpsServer({ key: await readFile(join(work, 'key.pem')), cert: await readFile(join(work, 'cert.pem')) }, (req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if (host === RELAY_HOST) return relay.handleHttp(req, res);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(host === SITE_HOST ? northwind : '<title>ChatGPT</title><p>Connected.</p>');
});
https.on('upgrade', (req, socket, head) => {
  if (!relay.handleUpgrade(req, socket, head)) socket.destroy();
});
const httpsPort = await listen(https);
const agentServer = createHttpServer(relay.handleHttp);
const relayForAgents = `http://127.0.0.1:${await listen(agentServer)}`;

async function agent(token) {
  const client = new Client({ name: 'store', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${relayForAgents}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

// ---------- browser ----------

const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  headless: false,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  ignoreHTTPSErrors: true,
  viewport: { width: 760, height: 604 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-proxy-server',
    '--ignore-certificate-errors',
    `--host-resolver-rules=${[RELAY_HOST, SITE_HOST, CHATGPT_HOST].map((host) => `MAP ${host} 127.0.0.1:${httpsPort}`).join(',')}`,
  ],
});
const waitForPage = (fragment) => context.waitForEvent('page', { predicate: (page) => page.url().includes(fragment), timeout: 15000 });

async function shootPrompt(page, name) {
  await page.setViewportSize({ width: 420, height: 600 });
  await sleep(250);
  await page.screenshot({ path: join(raw, name) });
}

async function shootPanel(panel, name) {
  await sleep(400); // let the push animation finish
  await panel.screenshot({ path: join(raw, name) });
}

/** "Make a link with a key" in the panel, as a person would for a tool without sign-in. */
async function keyLink(panel, name, control) {
  await panel.getByRole('button', { name: 'Connect an AI tool', exact: true }).click();
  await panel.getByRole('button', { name: 'Make a link with a key', exact: true }).click();
  await panel.getByRole('button', { name, exact: true }).click();
  if (control) await panel.getByRole('radio', { name: 'Read and act' }).click();
  await panel.getByRole('button', { name: 'Make the link' }).click();
  const link = await panel.locator('code').first().textContent();
  const back = () => panel.locator('header button').first().click();
  await back();
  await back();
  return decodeURIComponent(new URL(link).pathname.slice('/mcp/'.length));
}

/** What ChatGPT does with the one URL: register, send the person to sign in, trade the code. */
async function chatgptSignIn() {
  const registered = await fetch(`${relayForAgents}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [CHATGPT_REDIRECT], token_endpoint_auth_method: 'none' }),
  }).then((response) => response.json());
  const verifier = randomBytes(32).toString('base64url');
  const authorize = new URL(`https://${RELAY_HOST}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: registered.client_id,
    redirect_uri: CHATGPT_REDIRECT,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'store',
    resource: `https://${RELAY_HOST}/mcp`,
  }).toString();

  const page = await context.newPage();
  await page.goto(authorize.href);
  await page.getByRole('button', { name: 'Continue in Tabpass' }).waitFor();
  await page.screenshot({ path: join(raw, 'authorize-page.png') });
  const opened = waitForPage('prompt.html?agent=');
  await page.getByRole('button', { name: 'Continue in Tabpass' }).click();
  const prompt = await opened;
  await prompt.getByRole('heading', { name: 'Connect ChatGPT to your browser?' }).waitFor();
  await shootPrompt(prompt, 'prompt-agent.png');
  await prompt.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForURL(new RegExp(`^${CHATGPT_REDIRECT}\\?`), { timeout: 15000 });
  const code = new URL(page.url()).searchParams.get('code');
  await page.close();
  const tokens = await fetch(`${relayForAgents}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CHATGPT_REDIRECT, client_id: registered.client_id, code_verifier: verifier }),
  }).then((response) => response.json());
  assert.ok(tokens.access_token, JSON.stringify(tokens));
  return tokens.access_token;
}

const clients = [];
let exitCode = 0;
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  const site = context.pages()[0] ?? (await context.newPage());
  await site.goto(`https://${SITE_HOST}/`);
  await site.screenshot({ path: join(raw, 'site.png') });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 1200 }); // taller than the frame shows, so no scrollbar
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  // Chrome on macOS hides idle scrollbars; Linux would draw one in every long screen.
  await panel.addStyleTag({ content: '*::-webkit-scrollbar { display: none; }' });
  await panel.getByRole('button', { name: 'Got it' }).click();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'setBrowserName', browserName: 'Work laptop' }));
  await panel.getByRole('status').getByText('Connected · Work laptop').waitFor({ timeout: 15000 });
  assert.equal(await panel.getByRole('region', { name: 'Migma', exact: true }).count(), 0, 'Store builds must not offer the unfinished Migma connection');

  // Two tools connect with a link; each panel shot shows the moment its prompt belongs to.
  const cursor = await agent(await keyLink(panel, 'Cursor', false));
  const claude = await agent(await keyLink(panel, 'Claude', true));
  clients.push(cursor, claude);
  await cursor.callTool({ name: 'list_tabs', arguments: {} });
  const tabs = textOf(await claude.callTool({ name: 'list_tabs', arguments: {} }));
  const tabId = Number(/\[(\d+)\] Northwind Studio/.exec(tabs)?.[1]);
  assert.ok(tabId, tabs);
  await panel.getByText('Claude · list tabs').waitFor();
  await shootPanel(panel, 'home-before-site.png');

  const prompted = waitForPage('prompt.html?id=');
  const reading = claude.callTool({ name: 'read_page', arguments: { tabId } });
  const prompt = await prompted;
  await prompt.getByRole('button', { name: 'Always allow', exact: true }).waitFor();
  await shootPrompt(prompt, 'prompt-site.png');
  await prompt.getByRole('button', { name: 'Always allow', exact: true }).click();
  assert.match(textOf(await reading), /Made slowly, by hand/);
  await claude.callTool({ name: 'extract_design', arguments: { tabId } });
  await panel.getByText('Claude · extract design').waitFor();
  await shootPanel(panel, 'home-before-sign-in.png');

  // ChatGPT uses the one URL and signs in.
  const chatgpt = await agent(await chatgptSignIn());
  clients.push(chatgpt);
  await chatgpt.callTool({ name: 'read_page', arguments: { tabId } });

  await panel.bringToFront();
  await panel.getByText('ChatGPT · read page').waitFor();
  await shootPanel(panel, 'home.png');
  await panel.getByRole('button', { name: 'Connect an AI tool', exact: true }).click();
  await panel.locator('code', { hasText: `https://${RELAY_HOST}/mcp` }).first().waitFor();
  await shootPanel(panel, 'connect.png');
  await panel.locator('header button').first().click();
  await panel.emulateMedia({ colorScheme: 'dark' });
  await shootPanel(panel, 'home-dark.png');
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  await context.close();
  relay.close();
  https.close();
  agentServer.close();
}
if (exitCode) {
  if (!process.env.RAW_DIR) await rm(work, { recursive: true, force: true });
  process.exit(exitCode);
}

// ---------- compose ----------

const image = async (name) => `data:image/png;base64,${(await readFile(join(raw, name))).toString('base64')}`;
const icon = `data:image/png;base64,${(await readFile(join(root, 'extension', 'public', 'icons', 'icon-128.png'))).toString('base64')}`;
const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, 'Segoe UI', Roboto, sans-serif`;

/** A browser window: the site on the left, the side panel on the right, a prompt window on top. */
function frame({ caption, page, panel, prompt, promptLeft = 310, dark = false }) {
  const bg = dark ? '#000' : '#f2f2f7';
  const ink = dark ? '#f5f5f7' : '#1c1c1e';
  return `<!doctype html><html><head><style>
    *{box-sizing:border-box;margin:0}
    body{width:1280px;height:800px;background:${bg};font-family:${FONT};color:${ink};overflow:hidden}
    h1{position:absolute;top:44px;left:0;right:0;text-align:center;font-size:40px;font-weight:700;letter-spacing:-.02em}
    .window{position:absolute;left:70px;top:132px;width:1140px;height:640px;border-radius:14px;overflow:hidden;background:${dark ? '#2c2c2e' : '#e5e5ea'};
      box-shadow:0 0 0 1px rgba(0,0,0,${dark ? '.6' : '.08'}),0 24px 60px rgba(0,0,0,${dark ? '.5' : '.12'})}
    .bar{height:36px;display:flex;align-items:center;gap:8px;padding:0 16px}
    .bar i{width:12px;height:12px;border-radius:50%;background:${dark ? '#48484a' : '#c7c7cc'}}
    .content{position:absolute;top:36px;left:0;right:0;bottom:0;display:flex}
    .page{flex:1;background:#fff url(${page}) top left/760px auto no-repeat}
    .panel{width:380px;flex:none;background:url(${panel}) top left/380px auto no-repeat;border-left:1px solid rgba(0,0,0,.12)}
    .prompt{position:absolute;top:168px;left:${promptLeft}px;width:420px;height:580px;border-radius:12px;overflow:hidden;
      background:url(${prompt}) top center/420px auto no-repeat;box-shadow:0 0 0 1px rgba(0,0,0,.12),0 30px 80px rgba(0,0,0,.28)}
  </style></head><body>
    <h1>${caption}</h1>
    <div class="window"><div class="bar"><i></i><i></i><i></i></div>
      <div class="content"><div class="page"></div><div class="panel"></div></div></div>
    ${prompt ? '<div class="prompt"></div>' : ''}
  </body></html>`;
}

function tile({ width, height }) {
  return `<!doctype html><html><head><style>
    *{margin:0}body{width:${width}px;height:${height}px;background:#18181b;color:#fafafa;font-family:${FONT};
      display:flex;align-items:center;justify-content:center;gap:${height / 10}px}
    img{width:${height * 0.38}px;height:${height * 0.38}px;border-radius:${height * 0.085}px;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
    h1{font-size:${height * 0.16}px;font-weight:700;letter-spacing:-.02em}
    p{font-size:${height * 0.075}px;color:#a1a1aa;margin-top:${height * 0.02}px}
  </style></head><body><img src="${icon}"><div><h1>Tabpass</h1><p>Your AI, your open tabs.</p></div></body></html>`;
}

const site = await image('site.png');
const home = await image('home.png');
const screens = [
  ['01-home.png', { caption: 'Your AI, your open tabs.', page: site, panel: home }],
  ['02-connect.png', { caption: 'One link connects any AI tool.', page: site, panel: await image('connect.png') }],
  ['03-approve-sites.png', { caption: 'You approve each new site.', page: site, panel: await image('home-before-site.png'), prompt: await image('prompt-site.png') }],
  // The sign-in page stays in view on the left; Tabpass asks on the right.
  ['04-sign-in.png', {
    caption: 'Sign in once. You choose what it can do.',
    page: await image('authorize-page.png'),
    panel: await image('home-before-sign-in.png'),
    prompt: await image('prompt-agent.png'),
    promptLeft: 770,
  }],
  ['05-dark.png', { caption: 'Light or dark, it follows Chrome.', page: site, panel: await image('home-dark.png'), dark: true }],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const [name, options] of screens) {
  await tab.setContent(frame(options), { waitUntil: 'load' });
  await tab.screenshot({ path: join(out, name) });
}
for (const [name, width, height] of [
  ['promo-small-440x280.png', 440, 280],
  ['promo-marquee-1400x560.png', 1400, 560],
]) {
  await tab.setViewportSize({ width, height });
  await tab.setContent(tile({ width, height }), { waitUntil: 'load' });
  await tab.screenshot({ path: join(out, name) });
}
await browser.close();
if (!process.env.RAW_DIR) await rm(work, { recursive: true, force: true });
console.log(`Store images written to ${out}`);
