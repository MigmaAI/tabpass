// Site readers for pages whose text is not in the DOM. Google Docs draws text on a canvas, so the
// DOM reader sees almost nothing; its export endpoint returns the whole document instead, using the
// user's own Google session. Add a reader here when another app hides its content the same way.

import { callPage } from './page.js';

const PDF_READER_FILE = 'content/pdf-reader.js';

function googleExports(url, format) {
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
    const markdown = { url: `${base}?format=md`, kind: 'Google Doc (Markdown export)' };
    const text = { url: `${base}?format=txt`, kind: 'Google Doc (text export)' };
    if (format === 'text') return [text, markdown];
    if (format === 'html') return [{ url: `${base}?format=html`, kind: 'Google Doc (HTML export)', html: true }, markdown, text];
    return [markdown, text];
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

async function fetchFromWorker({ url, html = false }) {
  const response = await fetch(url, { credentials: 'include' });
  const type = response.headers.get('content-type') ?? '';
  // A signed-out export redirects to an HTML sign-in page, which is never the document.
  const signedOut = !html || new URL(response.url).hostname === 'accounts.google.com';
  if (!response.ok || (type.includes('text/html') && signedOut)) throw new Error(`Export failed (${response.status})`);
  return response.text();
}

/** Returns `{ kind, text }` for a page with a dedicated reader, or null to fall back to the DOM. */
export async function readWithSiteReader(tabId, url, format) {
  const candidates = googleExports(url, format);
  if (!candidates) return null;
  for (const candidate of candidates) {
    try {
      return { kind: candidate.kind, text: await fetchFromWorker(candidate) };
    } catch {
      // The worker may lack the session cookie; retry from inside the page.
    }
    try {
      const { text } = await callPage(tabId, 'fetchText', { url: candidate.url, html: candidate.html });
      return { kind: candidate.kind, text };
    } catch {
      // Try the next format, then the DOM reader.
    }
  }
  return null;
}

/** The text of the PDF in a tab. pdf.js is large, so it goes into a tab only when a PDF is read there. */
export async function readPdf(tabId, args) {
  const loaded = await callPage(tabId, 'readPdf', args);
  if (loaded) return loaded;
  await chrome.scripting.executeScript({ target: { tabId }, files: [PDF_READER_FILE] });
  return callPage(tabId, 'readPdf', args);
}
