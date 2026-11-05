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
    // Google's HTML export contains scripts, styles and hidden document state. Use the text
    // export as escaped HTML instead, with no executable markup or form values to sanitize.
    if (format === 'html') return [{ ...text, kind: 'Google Doc (text export as HTML)', render: 'text' }];
    return [markdown, text];
  }

  const sheet = /^\/spreadsheets\/((?:u\/\d+\/)?)d\/([^/]+)/.exec(parsed.pathname);
  if (sheet) {
    const gid = /gid=(\d+)/.exec(parsed.hash)?.[1] ?? parsed.searchParams.get('gid') ?? '0';
    return [
      {
        url: `https://docs.google.com/spreadsheets/${sheet[1]}d/${sheet[2]}/export?format=csv&gid=${gid}`,
        kind: format === 'html' ? 'Google Sheet, current tab (CSV export as HTML)' : 'Google Sheet, current tab (CSV export)',
        ...(format === 'html' ? { render: 'csv' } : {}),
      },
    ];
  }
  return null;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// CSV exports quote commas, line breaks and doubled quotes inside cells. Preserve them while
// building HTML from text alone; exported cell contents never become attributes or markup.
function csvHtml(csv) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endCell = () => { row.push(`<td>${escapeHtml(cell)}</td>`); cell = ''; };
  const endRow = () => { endCell(); rows.push(`<tr>${row.join('')}</tr>`); row = []; };
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === ',') endCell();
    else if (char === '\r' || char === '\n') {
      endRow();
      if (char === '\r' && csv[i + 1] === '\n') i += 1;
    } else cell += char;
  }
  if (row.length || cell || (csv && !/[\r\n]$/.test(csv))) endRow();
  return `<table><tbody>${rows.join('')}</tbody></table>`;
}

async function fetchFromWorker({ url }) {
  const response = await fetch(url, { credentials: 'include' });
  const type = response.headers.get('content-type') ?? '';
  // A signed-out export redirects to an HTML sign-in page, which is never the document.
  if (!response.ok || /text\/html|application\/xhtml\+xml/i.test(type)
    || (response.url && new URL(response.url).hostname === 'accounts.google.com')) throw new Error(`Export failed (${response.status})`);
  return response.text();
}

/** Returns `{ kind, text }` for a page with a dedicated reader, or null to fall back to the DOM. */
export async function readWithSiteReader(tabId, url, format) {
  const candidates = googleExports(url, format);
  if (!candidates) return null;
  for (const candidate of candidates) {
    let text;
    try {
      text = await fetchFromWorker(candidate);
    } catch {
      // The worker may lack the session cookie; retry from inside the page.
      try {
        ({ text } = await callPage(tabId, 'fetchText', { url: candidate.url }));
      } catch {
        // Try the next format, then the DOM reader.
        continue;
      }
    }
    if (candidate.render === 'text') text = `<pre>${escapeHtml(text)}</pre>`;
    else if (candidate.render === 'csv') text = csvHtml(text);
    return { kind: candidate.kind, text };
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
