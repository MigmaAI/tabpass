import { ACCESS_TEXT, DECISION_BUTTONS, h, send, timeAgo } from './ui.js';

const TAB_GROUP_COLORS = {
  grey: '#71717a',
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
  pink: '#ec4899',
  purple: '#a855f7',
  cyan: '#06b6d4',
  orange: '#f97316',
};
const NAME_SUGGESTIONS = ['Claude', 'ChatGPT', 'Cursor', 'Migma'];
const STATUS_TEXT = { connected: 'Connected', connecting: 'Connecting…', offline: 'Offline', error: 'Not connected' };
const ACCESS_HINT = {
  read: 'It can list tabs, read pages, see screenshots and pull design details.',
  control: 'It can also open tabs, click, type and fill forms, signed in as you.',
};

const $ = (id) => document.getElementById(id);
let current = null;
let expandedAgentId = null;
const rendered = {};

/** Re-render a region only when its data changed, so open forms and focus survive live updates. */
function renderOnce(key, data, render) {
  const signature = JSON.stringify(data);
  if (rendered[key] === signature) return;
  rendered[key] = signature;
  render(data);
}

function mcpUrlFor(state) {
  if (state.status.mcpUrl) return state.status.mcpUrl;
  return state.settings.relayUrl.replace(/^ws/, 'http').replace(/\/extension\/?$/, '/mcp');
}

function copyField(label, value, hint) {
  const button = h('button', { type: 'button', class: 'btn small' }, 'Copy');
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(value);
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = 'Copy'), 1500);
  });
  return h(
    'div',
    { class: 'field' },
    h('span', {}, label),
    h('div', { class: 'copy' }, h('code', { title: value }, value), button),
    hint ? h('p', { class: 'hint' }, hint) : null
  );
}

function codeBlock(label, value) {
  const button = h('button', { type: 'button', class: 'btn ghost small' }, 'Copy');
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(value);
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = 'Copy'), 1500);
  });
  return h(
    'div',
    { class: 'field' },
    h('div', { class: 'head' }, h('span', { class: 'hint' }, label), h('span', { style: 'margin-left:auto' }, button)),
    h('pre', { class: 'code' }, value)
  );
}

function agentDetails(agent, mcpUrl) {
  const connectorUrl = `${mcpUrl}/${agent.token}`;
  const claudeCode = `claude mcp add --transport http migma-tabs ${mcpUrl} \\\n  --header "Authorization: Bearer ${agent.token}"`;
  const json = JSON.stringify(
    { mcpServers: { 'migma-tabs': { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${agent.token}` } } } },
    null,
    2
  );

  const access = h(
    'select',
    {
      'aria-label': 'Access',
      onchange: (event) => send('setAgentAccess', { id: agent.id, access: event.target.value }).then(refresh),
    },
    h('option', { value: 'read', selected: agent.access === 'read' }, 'Read'),
    h('option', { value: 'control', selected: agent.access === 'control' }, 'Read and act')
  );

  return h(
    'div',
    { class: 'details' },
    copyField('Connector URL', connectorUrl, 'Paste it as a custom MCP connector. Keep it private: it opens your browser.'),
    h(
      'details',
      {},
      h('summary', { class: 'hint', style: 'cursor:pointer' }, 'Connect with a header instead'),
      h('div', { class: 'field', style: 'margin-top:8px' }, codeBlock('Claude Code', claudeCode), codeBlock('MCP config', json))
    ),
    h('label', { class: 'field' }, h('span', {}, 'It can'), access),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn ghost small danger',
          onclick: async () => {
            if (!confirm(`Disconnect ${agent.label}? It will lose access right away.`)) return;
            await send('removeAgent', { id: agent.id });
            refresh();
          },
        },
        'Disconnect'
      )
    )
  );
}

function renderAgents({ agents, mcpUrl, expanded }) {
  const list = $('agents');
  list.replaceChildren(
    ...agents.map((agent) => {
      const open = agent.id === expanded;
      const row = h(
        'button',
        {
          type: 'button',
          class: 'row',
          'aria-expanded': String(open),
          onclick: () => {
            expandedAgentId = open ? null : agent.id;
            render();
          },
        },
        h('span', { class: 'swatch', style: `background:${TAB_GROUP_COLORS[agent.color] ?? TAB_GROUP_COLORS.blue}` }),
        h(
          'span',
          { style: 'flex:1;min-width:0' },
          h('span', { class: 'name' }, agent.label),
          h('span', { class: 'meta' }, `${ACCESS_TEXT[agent.access]} · ${agent.lastUsedAt ? `used ${timeAgo(agent.lastUsedAt)}` : 'not used yet'}`)
        )
      );
      return h('li', { class: 'agent' }, row, open ? agentDetails(agent, mcpUrl) : null);
    })
  );
}

function renderStatus({ status, paused }) {
  const state = paused ? 'offline' : status.state;
  $('status').replaceChildren(
    h('span', { class: `dot ${state}` }),
    paused ? 'Paused' : STATUS_TEXT[status.state] ?? status.state
  );
  $('enabled').checked = !paused;
  $('enabled-label').textContent = paused ? 'Paused' : 'On';
  $('relay-status').textContent =
    status.state === 'connected' ? `Connected. Agents reach this browser at ${status.mcpUrl}.` : status.message ?? '';
}

function renderPrompts(prompts) {
  const container = $('prompts');
  container.hidden = prompts.length === 0;
  container.replaceChildren(
    ...prompts.map((prompt) =>
      h(
        'div',
        { class: 'prompt-card', role: 'alert' },
        h('h3', {}, `${prompt.agentLabel} wants to use ${prompt.site}`),
        h('p', { class: 'hint' }, prompt.url),
        h(
          'div',
          { class: 'actions' },
          DECISION_BUTTONS.map(({ decision, label, className }) =>
            h(
              'button',
              {
                type: 'button',
                class: `${className} small`,
                onclick: () => send('promptDecision', { id: prompt.id, decision }).then(refresh),
              },
              label
            )
          )
        )
      )
    )
  );
}

function renderActivity(activity) {
  $('activity-count').textContent = activity.length ? `· ${activity.length}` : '';
  const list = $('activity');
  if (!activity.length) {
    list.replaceChildren(h('li', { class: 'hint' }, 'What your agents do shows up here.'));
    return;
  }
  list.replaceChildren(
    ...activity.slice(0, 30).map((entry) =>
      h(
        'li',
        {},
        h('span', {}, `${entry.agent} · ${entry.tool.replace(/_/g, ' ')}${entry.site ? ` · ${entry.site}` : ''}`),
        entry.ok ? null : h('span', { class: 'error' }, entry.detail),
        h('span', { class: 'when' }, timeAgo(entry.at))
      )
    )
  );
}

function siteRows(sites, list) {
  if (!sites.length) return [h('li', { class: 'hint' }, 'None yet.')];
  return sites.map((site) =>
    h(
      'li',
      {},
      h('span', {}, site),
      h(
        'button',
        {
          type: 'button',
          class: 'btn ghost small',
          'aria-label': `Remove ${site}`,
          onclick: () => send('removeSite', { site, list }).then(refresh),
        },
        'Remove'
      )
    )
  );
}

function renderSites({ sites, allowAll }) {
  $('allow-all').checked = allowAll;
  $('allowed-sites').replaceChildren(...siteRows(sites.allowed, 'allowed'));
  $('blocked-sites').replaceChildren(...siteRows(sites.blocked, 'blocked'));
}

function render() {
  if (!current) return;
  const { settings, agents, sites, status, prompts, activity } = current;
  renderOnce('status', { status, paused: settings.paused }, renderStatus);
  renderOnce('prompts', prompts, renderPrompts);
  renderOnce('agents', { agents, mcpUrl: mcpUrlFor(current), expanded: expandedAgentId }, renderAgents);
  renderOnce('activity', activity, renderActivity);
  renderOnce('sites', { sites, allowAll: settings.allowAllSites }, renderSites);
  if (document.activeElement !== $('relay-input')) $('relay-input').value = settings.relayUrl;
}

let refreshSeq = 0;

async function refresh() {
  // Refreshes overlap (storage events, timers, clicks); only the newest may paint, or an older
  // answer could land last and show stale state.
  const seq = ++refreshSeq;
  const state = await send('getState');
  if (seq !== refreshSeq) return;
  current = state;
  render();
}

// ---------- new agent form ----------

function setFormOpen(open) {
  $('agent-form').hidden = !open;
  $('add-agent').hidden = open;
  $('agent-error').hidden = true;
  if (open) {
    $('agent-name').value = '';
    // Every new agent starts at the safer level; acting is a deliberate choice.
    document.querySelector('input[name="access"][value="read"]').checked = true;
    updateAccessHint();
    $('agent-name').focus();
  }
}

function updateAccessHint() {
  const access = document.querySelector('input[name="access"]:checked').value;
  $('access-hint').textContent = ACCESS_HINT[access];
}

$('name-chips').replaceChildren(
  ...NAME_SUGGESTIONS.map((name) =>
    h('button', { type: 'button', class: 'btn chip', onclick: () => ($('agent-name').value = name) }, name)
  )
);
$('add-agent').addEventListener('click', () => setFormOpen(true));
$('cancel-agent').addEventListener('click', () => setFormOpen(false));
for (const radio of document.querySelectorAll('input[name="access"]')) radio.addEventListener('change', updateAccessHint);
updateAccessHint();

$('agent-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const access = document.querySelector('input[name="access"]:checked').value;
    const agent = await send('addAgent', { label: $('agent-name').value, access });
    expandedAgentId = agent.id;
    setFormOpen(false);
    await refresh();
  } catch (error) {
    $('agent-error').textContent = error.message;
    $('agent-error').hidden = false;
  }
});

// ---------- other controls ----------

$('enabled').addEventListener('change', (event) => send('setPaused', { paused: !event.target.checked }).then(refresh));
$('allow-all').addEventListener('change', async (event) => {
  if (event.target.checked && !confirm('Let every agent use any site without asking you first?')) {
    event.target.checked = false;
    return;
  }
  await send('setAllowAllSites', { value: event.target.checked });
  refresh();
});
$('clear-activity').addEventListener('click', () => send('clearActivity').then(refresh));

$('site-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const list = event.submitter?.dataset.list ?? 'allowed';
  try {
    await send('addSite', { site: $('site-input').value, list });
    $('site-input').value = '';
    refresh();
  } catch (error) {
    alert(error.message);
  }
});

$('relay-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('relay-error').hidden = true;
  try {
    await send('setRelayUrl', { relayUrl: $('relay-input').value });
    $('relay-input').blur();
    refresh();
  } catch (error) {
    $('relay-error').textContent = error.message;
    $('relay-error').hidden = false;
  }
});

chrome.storage.onChanged.addListener(() => refresh());
setInterval(refresh, 30_000); // keeps "used 2m ago" honest
refresh();
