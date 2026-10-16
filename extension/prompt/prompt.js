import { DECISION_BUTTONS, h, send } from '../sidepanel/ui.js';

const id = new URLSearchParams(location.search).get('id');
const WHAT = {
  read: 'It will read pages on this site, signed in as you.',
  control: 'It will read pages on this site and act on them (click, type, fill forms), signed in as you.',
};

async function decide(decision) {
  if (decision === 'all' && !confirm('Let every agent use any site without asking you first?')) return;
  await send('promptDecision', { id, decision });
  window.close();
}

async function load() {
  const state = await send('getState');
  const prompt = state.prompts.find((candidate) => candidate.id === id);
  if (!prompt) {
    document.getElementById('gone').hidden = false;
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    return;
  }
  document.title = `Allow ${prompt.agentLabel} on ${prompt.site}?`;
  document.getElementById('title').textContent = `Allow ${prompt.agentLabel} to use ${prompt.site}?`;
  document.getElementById('what').textContent = WHAT[prompt.access] ?? WHAT.read;
  document.getElementById('url').textContent = prompt.url;
  document.getElementById('buttons').replaceChildren(
    ...[...DECISION_BUTTONS].reverse().map(({ decision, label, className }) =>
      h('button', { type: 'button', class: `${className} block-btn`, onclick: () => decide(decision) }, label)
    )
  );
  document.querySelector('.btn.primary')?.focus();
}

for (const button of document.querySelectorAll('[data-decision]')) {
  button.addEventListener('click', () => decide(button.dataset.decision));
}
load();
