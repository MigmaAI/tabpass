// The page an MCP client opens in the browser to connect. It finds the Tabpass extension through
// the Tabpass Web Protocol (window.postMessage, answered by the extension's content script), asks it
// to connect, and the person approves in Tabpass's own window. Self-contained: no external assets.

import type { AgentAccess } from './protocol.js';

export interface AuthorizePageInput {
  clientName: string;
  returnsTo: string;
  requestedAccess: AgentAccess;
  ticket: string;
  installUrl: string;
  nonce: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

const ICON = `<svg viewBox="0 0 128 128" width="64" height="64" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#18181b"/><path d="M22 44a8 8 0 0 1 8-8h24a8 8 0 0 1 6.9 4l5.2 9H98a8 8 0 0 1 8 8v39a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8Z" fill="none" stroke="#fafafa" stroke-width="9" stroke-linejoin="round"/><circle cx="64" cy="76" r="11" fill="#3b82f6"/></svg>`;

const STYLE = `
:root{--bg:#f2f2f7;--card:#fff;--text:#1c1c1e;--muted:#6e6e73;--line:rgba(60,60,67,.14);--primary:#1c1c1e;--on-primary:#fff;--danger:#d70015;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--muted:#98989d;--line:rgba(84,84,88,.5);--primary:#f5f5f7;--on-primary:#1c1c1e;--danger:#ff6961}}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text)}
body{font:15px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;display:grid;place-items:center;min-height:100vh;padding:24px}
main{width:100%;max-width:400px;display:grid;gap:20px;text-align:center}
.head{display:grid;gap:8px}
.icon{justify-self:center;border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
h1{margin:0;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-.01em}
p{margin:0;color:var(--muted)}
.list{background:var(--card);border-radius:14px;text-align:left;overflow:hidden}
.row{display:flex;justify-content:space-between;gap:12px;padding:12px 16px}
.row+.row{border-top:.5px solid var(--line)}
.row span:first-child{color:var(--muted)}
.row span:last-child{font-weight:500;text-align:right;overflow-wrap:anywhere}
.actions{display:grid;gap:10px}
button,a.button{font:inherit;font-weight:600;border:0;border-radius:999px;height:48px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;transition:opacity .15s}
button:focus-visible,a.button:focus-visible{outline:3px solid #0a84ff;outline-offset:2px}
.note a{color:inherit;font-weight:600}
.primary{background:var(--primary);color:var(--on-primary)}
.secondary{background:transparent;color:var(--text)}
button:disabled{opacity:.5;cursor:default}
.note{font-size:13px}
.error{color:var(--danger)}
.spinner{width:18px;height:18px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:spin .8s linear infinite;margin-right:10px}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation:none}}
[hidden]{display:none!important}
`;

export function renderAuthorizePage(input: AuthorizePageInput): string {
  const name = escapeHtml(input.clientName);
  const config = JSON.stringify({
    ticket: input.ticket,
    name: input.clientName,
    returnsTo: input.returnsTo,
    access: input.requestedAccess,
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect ${name} to Tabpass</title>
<style nonce="${input.nonce}">${STYLE}</style>
</head>
<body>
<main>
  <div class="icon">${ICON}</div>
  <div class="head">
    <h1 id="title">Connect ${name} to your browser</h1>
    <p id="lead">${name} will use your open tabs through Tabpass. You approve each new site.</p>
  </div>
  <div class="list" id="details">
    <div class="row"><span>Returns to</span><span>${escapeHtml(input.returnsTo)}</span></div>
    <div class="row"><span>Asks for</span><span>${input.requestedAccess === 'control' ? 'Read and act' : 'Read'}</span></div>
  </div>
  <div class="actions" id="ready">
    <button class="primary" id="continue" type="button">Continue in Tabpass</button>
    <button class="secondary" id="cancel" type="button">Cancel</button>
    <p class="note" id="install-hint" hidden>No Tabpass yet? <a href="${escapeHtml(input.installUrl)}" target="_blank" rel="noopener">Install it</a>, then come back.</p>
  </div>
  <div class="actions" id="waiting" hidden>
    <button class="primary" type="button" disabled><span class="spinner" aria-hidden="true"></span>Approve in the Tabpass window</button>
  </div>
  <div class="actions" id="missing" hidden>
    <p>Tabpass is not in this browser yet.</p>
    <a class="button primary" href="${escapeHtml(input.installUrl)}" target="_blank" rel="noopener">Install Tabpass</a>
    <button class="secondary" id="retry" type="button">I installed it</button>
    <p class="note">Already installed? Open this page in the Chrome profile that has Tabpass.</p>
  </div>
  <div class="actions" id="done" hidden>
    <p>Connected. You can go back to ${name}.</p>
  </div>
  <p class="note error" id="error" role="alert" hidden></p>
</main>
<script nonce="${input.nonce}">
(() => {
  const config = ${config};
  const $ = (id) => document.getElementById(id);
  const views = ['ready', 'waiting', 'missing', 'done'];
  const show = (view, error) => {
    for (const id of views) $(id).hidden = id !== view;
    $('error').hidden = !error;
    $('error').textContent = error || '';
  };

  // Tabpass Web Protocol v1: ask the extension through its content script.
  function ask(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { window.removeEventListener('message', onMessage); reject(Object.assign(new Error('Tabpass did not answer.'), { code: 'no_answer' })); }, timeoutMs);
      function onMessage(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (!data || data.tabpass !== 'response' || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (data.error) reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
        else resolve(data.result);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ tabpass: 'request', id, method, params }, location.origin);
    });
  }

  async function finish(body) {
    const response = await fetch('/authorize/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: config.ticket, ...body }) });
    const result = await response.json();
    if (!response.ok || !result.redirect) throw new Error(result.error || 'Something went wrong.');
    if (!body.error) show('done');
    location.href = result.redirect;
  }

  async function connect() {
    show('waiting');
    try {
      const result = await ask('connect', { name: config.name, access: config.access, relay: true, returnsTo: config.returnsTo }, 130000);
      await finish({ token: result.token });
    } catch (error) {
      if (error.code === 'no_answer') show('missing');
      else if (error.code === 'declined') show('ready', 'Not connected. You can try again.');
      else show('ready', error.message);
    }
  }

  $('continue').addEventListener('click', connect);
  $('retry').addEventListener('click', connect);
  $('cancel').addEventListener('click', () => finish({ error: 'access_denied' }).catch((error) => show('ready', error.message)));
  // Tabpass answers here without a click when this relay is the one it uses. Otherwise it stays
  // silent until the person clicks (so sites cannot detect it), and we offer the install link too.
  ask('hello', {}, 1500).then(() => show('ready'), () => { show('ready'); $('install-hint').hidden = false; });
})();
</script>
</body>
</html>`;
}

export function renderErrorPage(message: string, nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tabpass</title>
<style nonce="${nonce}">${STYLE}</style></head>
<body><main><div class="icon">${ICON}</div><h1>Can't connect</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}
