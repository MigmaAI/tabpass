import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callPage: vi.fn(), fetch: vi.fn() }));

vi.mock('../../extension/public/lib/page.js', () => ({ callPage: mocks.callPage }));

// The extension runtime is plain JavaScript and intentionally has no TypeScript declaration surface.
// @ts-expect-error importing the runtime entrypoint is the behavior under test
import { readWithSiteReader } from '../../extension/public/lib/readers.js';

const tabId = 7;
const docUrl = 'https://docs.google.com/document/u/1/d/doc-id/edit';
const docExport = 'https://docs.google.com/document/u/1/d/doc-id/export';
const sheetUrl = 'https://docs.google.com/spreadsheets/u/2/d/sheet-id/edit?gid=45#gid=78';
const sheetExport = 'https://docs.google.com/spreadsheets/u/2/d/sheet-id/export?format=csv&gid=78';

function exportResponse(text: string, options: { url?: string; contentType?: string; status?: number } = {}) {
  const { url = `${docExport}?format=txt`, contentType = 'text/plain; charset=utf-8', status = 200 } = options;
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
    text: vi.fn(async () => text),
  };
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.callPage.mockReset();
  mocks.fetch.mockRejectedValue(new Error('Worker cannot fetch the export'));
  mocks.callPage.mockRejectedValue(new Error('Page cannot fetch the export'));
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe('Google Docs site reader', () => {
  const text = 'Hello <script>alert("x" & \'y\')</script>\n<strong>bold</strong>';
  const html = '<pre>Hello &lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;\n&lt;strong&gt;bold&lt;/strong&gt;</pre>';

  it.each(['worker', 'page'])('converts the TXT export to escaped HTML through the %s', async (source) => {
    if (source === 'worker') mocks.fetch.mockResolvedValue(exportResponse(text));
    else mocks.callPage.mockResolvedValue({ text });

    expect(await readWithSiteReader(tabId, docUrl, 'html')).toEqual({
      kind: 'Google Doc (text export as HTML)',
      text: html,
    });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`${docExport}?format=txt`, { credentials: 'include' });
    if (source === 'page') {
      expect(mocks.callPage).toHaveBeenCalledExactlyOnceWith(tabId, 'fetchText', { url: `${docExport}?format=txt` });
    } else {
      expect(mocks.callPage).not.toHaveBeenCalled();
    }
  });

  it('returns no site result when the TXT export fails, without requesting raw HTML or Markdown', async () => {
    expect(await readWithSiteReader(tabId, docUrl, 'html')).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`${docExport}?format=txt`, { credentials: 'include' });
    expect(mocks.callPage).toHaveBeenCalledExactlyOnceWith(tabId, 'fetchText', { url: `${docExport}?format=txt` });
  });

  it.each([
    { name: 'HTML at the export URL', url: `${docExport}?format=txt`, contentType: 'text/html; charset=utf-8' },
    { name: 'mixed-case HTML content type', url: `${docExport}?format=txt`, contentType: 'Text/HTML; charset=UTF-8' },
    { name: 'a sign-in redirect labeled as plain text', url: 'https://accounts.google.com/ServiceLogin', contentType: 'text/plain' },
  ])('never returns $name as document content', async ({ url, contentType }) => {
    const response = exportResponse('<html><form>Sign in</form></html>', { url, contentType });
    mocks.fetch.mockResolvedValue(response);

    expect(await readWithSiteReader(tabId, docUrl, 'html')).toBeNull();
    expect(response.text).not.toHaveBeenCalled();
    expect(mocks.callPage).toHaveBeenCalledExactlyOnceWith(tabId, 'fetchText', { url: `${docExport}?format=txt` });
  });

  it.each([
    { format: undefined, extension: 'md', kind: 'Google Doc (Markdown export)', text: '# Title\n\nA **document**.' },
    { format: 'markdown', extension: 'md', kind: 'Google Doc (Markdown export)', text: '# Title\n\nA **document**.' },
    { format: 'text', extension: 'txt', kind: 'Google Doc (text export)', text: 'Title\n\nA document.' },
  ])('preserves the preferred export for format $format', async ({ format, extension, kind, text }) => {
    mocks.fetch.mockResolvedValue(exportResponse(text));

    expect(await readWithSiteReader(tabId, docUrl, format)).toEqual({ kind, text });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`${docExport}?format=${extension}`, { credentials: 'include' });
    expect(mocks.callPage).not.toHaveBeenCalled();
  });

  it.each([
    { format: 'markdown', first: 'md', fallback: 'txt', kind: 'Google Doc (text export)' },
    { format: 'text', first: 'txt', fallback: 'md', kind: 'Google Doc (Markdown export)' },
  ])('preserves the $format fallback after both fetch contexts fail for its preferred export', async ({ format, first, fallback, kind }) => {
    mocks.fetch.mockRejectedValueOnce(new Error('Preferred export unavailable'));
    mocks.fetch.mockResolvedValueOnce(exportResponse('Fallback document'));

    expect(await readWithSiteReader(tabId, docUrl, format)).toEqual({ kind, text: 'Fallback document' });
    expect(mocks.fetch.mock.calls).toEqual([
      [`${docExport}?format=${first}`, { credentials: 'include' }],
      [`${docExport}?format=${fallback}`, { credentials: 'include' }],
    ]);
    expect(mocks.callPage).toHaveBeenCalledExactlyOnceWith(tabId, 'fetchText', { url: `${docExport}?format=${first}` });
  });

  it('preserves Markdown returned from the page context', async () => {
    mocks.callPage.mockResolvedValue({ text: '# Page export\n\n**Still Markdown**' });

    expect(await readWithSiteReader(tabId, docUrl, 'markdown')).toEqual({
      kind: 'Google Doc (Markdown export)',
      text: '# Page export\n\n**Still Markdown**',
    });
    expect(mocks.callPage).toHaveBeenCalledExactlyOnceWith(tabId, 'fetchText', { url: `${docExport}?format=md` });
  });
});

describe('Google Sheets site reader', () => {
  const csv = 'Name,Note,Empty\r\n"A, B","line 1\nline 2",\r\n"<script>","He said ""hi"" & \'bye\'",\r\n,tail,\r\n';
  const html = '<table><tbody>'
    + '<tr><td>Name</td><td>Note</td><td>Empty</td></tr>'
    + '<tr><td>A, B</td><td>line 1\nline 2</td><td></td></tr>'
    + '<tr><td>&lt;script&gt;</td><td>He said &quot;hi&quot; &amp; &#39;bye&#39;</td><td></td></tr>'
    + '<tr><td></td><td>tail</td><td></td></tr>'
    + '</tbody></table>';

  it.each(['worker', 'page'])('renders the current sheet CSV as escaped HTML through the %s', async (source) => {
    if (source === 'worker') mocks.fetch.mockResolvedValue(exportResponse(csv, { url: sheetExport, contentType: 'text/csv' }));
    else mocks.callPage.mockResolvedValue({ text: csv });

    expect(await readWithSiteReader(tabId, sheetUrl, 'html')).toEqual({
      kind: 'Google Sheet, current tab (CSV export as HTML)',
      text: html,
    });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(sheetExport, { credentials: 'include' });
    if (source === 'page') {
      expect(mocks.callPage).toHaveBeenCalledExactlyOnceWith(tabId, 'fetchText', { url: sheetExport });
    } else {
      expect(mocks.callPage).not.toHaveBeenCalled();
    }
  });

  it.each([undefined, 'markdown', 'text'])('preserves the CSV export for format %s', async (format) => {
    mocks.fetch.mockResolvedValue(exportResponse(csv, { url: sheetExport, contentType: 'text/csv' }));

    expect(await readWithSiteReader(tabId, sheetUrl, format)).toEqual({
      kind: 'Google Sheet, current tab (CSV export)',
      text: csv,
    });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(sheetExport, { credentials: 'include' });
  });

  it.each([
    { suffix: '?gid=123', gid: '123' },
    { suffix: '', gid: '0' },
  ])('uses gid=$gid when the URL has no fragment gid', async ({ suffix, gid }) => {
    mocks.fetch.mockResolvedValue(exportResponse('a,b\n', { contentType: 'text/csv' }));

    expect(await readWithSiteReader(tabId, `https://docs.google.com/spreadsheets/d/sheet-id/edit${suffix}`, 'html')).toEqual({
      kind: 'Google Sheet, current tab (CSV export as HTML)',
      text: '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`https://docs.google.com/spreadsheets/d/sheet-id/export?format=csv&gid=${gid}`, { credentials: 'include' });
  });
});

it.each(['not a URL', 'https://example.com/document/d/doc-id/edit'])('leaves unsupported pages to the DOM reader: %s', async (url) => {
  expect(await readWithSiteReader(tabId, url, 'html')).toBeNull();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.callPage).not.toHaveBeenCalled();
});
