// Site readers for pages whose text is not in the DOM. Google Docs draws text on a canvas, so the
// DOM reader sees almost nothing; its export endpoint returns the whole document instead, using the
// user's own Google session. Add a reader here when another app hides its content the same way.

import { callPage } from './page.js';

function googleExports(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'docs.google.com') return null;

  const doc = /^\/document\/((?:u\/\d+\/)?)d\/([^/]+)/.exec(parsed.pathname);
  if (doc) {
    const base = `https://docs.google.com/document/${doc[1]}d/${doc[2]}/export`;
    return [
      { url: `${base}?format=md`, kind: 'Google Doc (Markdown export)' },
      { url: `${base}?format=txt`, kind: 'Google Doc (text export)' },
    ];
  }

  const sheet = /^\/spreadsheets\/((?:u\/\d+\/)?)d\/([^/]+)/.exec(parsed.pathname);
  if (sheet) {
    const gid = /gid=(\d+)/.exec(parsed.hash)?.[1] ?? parsed.searchParams.get('gid') ?? '0';
    return [
      {
        url: `https://docs.google.com/spreadsheets/${sheet[1]}d/${sheet[2]}/export?format=csv&gid=${gid}`,
        kind: 'Google Sheet, current tab (CSV export)',
      },
    ];
  }
  return null;
}

async function fetchFromWorker(url) {
  const response = await fetch(url, { credentials: 'include' });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || type.includes('text/html')) throw new Error(`Export failed (${response.status})`);
  return response.text();
}

/** Returns `{ kind, text }` for a page with a dedicated reader, or null to fall back to the DOM. */
export async function readWithSiteReader(tabId, url) {
  const candidates = googleExports(url);
  if (!candidates) return null;
  for (const candidate of candidates) {
    try {
      return { kind: candidate.kind, text: await fetchFromWorker(candidate.url) };
    } catch {
      // The worker may lack the session cookie; retry from inside the page.
    }
    try {
      const { text } = await callPage(tabId, 'fetchText', { url: candidate.url });
      return { kind: candidate.kind, text };
    } catch {
      // Try the next format, then the DOM reader.
    }
  }
  return null;
}
