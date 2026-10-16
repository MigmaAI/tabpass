// Small helpers shared by the side panel and the site-access prompt.

/** Builds an element. Strings become text nodes, never HTML. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Sends a request to the service worker; rejects with its error message. */
export async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? 'Something went wrong.');
  return response.result;
}

export function timeAgo(timestamp) {
  if (!timestamp) return 'never';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const ACCESS_TEXT = {
  read: 'Can read your tabs',
  control: 'Can read and act in your tabs',
};

export const DECISION_BUTTONS = [
  { decision: 'decline', label: 'Decline', className: 'btn' },
  { decision: 'once', label: 'Allow for 10 min', className: 'btn' },
  { decision: 'site', label: 'Always allow', className: 'btn primary' },
];
