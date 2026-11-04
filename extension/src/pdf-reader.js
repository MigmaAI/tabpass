// The text of the PDF open in this tab. tools.js injects this bundle into the tab's isolated world
// the first time an agent reads a PDF there, and never into any other tab.
//
// It runs here rather than in the service worker or an offscreen document because this needs no new
// permission, never stalls the relay connection and has no more reach than the page agent: a bug in
// pdf.js parsing a hostile file stays in a world that can see this one site. The file is requested
// again from inside the tab, so it goes out same-origin with the user's session, and nothing else is
// fetched. Importing pdf.js's worker code makes it run on this thread, because a content script
// cannot start a Worker from an extension file.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// Older than pdf.js's own floor but supported by the manifest (Chrome 116). These change only this
// isolated world's copies, never the page's.
Promise.withResolvers ??= function withResolvers() {
  let resolve;
  let reject;
  const promise = new this((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
ReadableStream.prototype[Symbol.asyncIterator] ??= async function* values() {
  const reader = this.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
};

const SCREENSHOT = 'Use screenshot to see the visible page.';

// One document per isolated world, so this lasts until the tab navigates or reloads. Pages are read
// as far as a read needs and kept, so `offset` is exact and the file is parsed once.
const state = { task: null, text: '', nextPage: 1, pages: 0, hasText: false, done: false, missingCMap: false };
let queue = Promise.resolve();

// Tabpass does not ship pdf.js's CMaps, fonts or decoders, and nothing here may load them from
// elsewhere. A missing CMap silently drops that text, so it is recorded and reported.
class NoBundledData {
  async fetch({ kind }) {
    if (kind === 'cMapUrl') state.missingCMap = true;
    throw new Error(`${kind} is not bundled with Tabpass.`);
  }
}

async function pageText(doc, number) {
  try {
    const page = await doc.getPage(number);
    const { items } = await page.getTextContent();
    page.cleanup();
    return items.map((item) => item.str + (item.hasEOL ? '\n' : '')).join('').trim();
  } catch (error) {
    return `[Tabpass could not read this page: ${error?.message ?? error}]`;
  }
}

async function readUntil(limit) {
  if (state.done) return;
  state.task ??= getDocument({
    url: location.href,
    withCredentials: true,
    // Only the parts of a large file that a read reaches are downloaded, when the server allows it.
    disableAutoFetch: true,
    disableStream: true,
    BinaryDataFactory: NoBundledData,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await state.task.promise;
  state.pages = doc.numPages;
  // A scanned file has only page markers, so keep going until a page has text or there are no more.
  while ((state.text.length <= limit || !state.hasText) && state.nextPage <= doc.numPages) {
    const words = await pageText(doc, state.nextPage);
    if (words) state.hasText = true;
    state.text += `--- Page ${state.nextPage} ---\n${words}\n\n`;
    state.nextPage += 1;
  }
  if (state.nextPage > doc.numPages) {
    state.done = true;
    state.task.destroy();
  }
}

function failure(error) {
  if (location.protocol === 'file:') return `Tabpass cannot read local PDF files. ${SCREENSHOT}`;
  switch (error?.name) {
    case 'PasswordException':
      return `This PDF needs a password, so Tabpass cannot read its text. ${SCREENSHOT}`;
    case 'InvalidPDFException':
      return `This file is not a valid PDF, so Tabpass cannot read its text. ${SCREENSHOT}`;
    case 'ResponseException':
      return `The site refused to send this PDF again (status ${error.status}), so Tabpass cannot read its text. ${SCREENSHOT}`;
    default:
      return `Tabpass could not read this PDF: ${error?.message ?? error}. ${SCREENSHOT}`;
  }
}

async function read({ url, offset, maxChars }) {
  if (location.href !== url || document.contentType !== 'application/pdf') {
    throw new Error('The page changed while it was being read. Read the current tab again.');
  }
  const limit = offset + maxChars;
  try {
    await readUntil(limit);
  } catch (error) {
    state.task?.destroy();
    state.task = null; // A later read tries again.
    return { format: 'pdf', text: '', truncated: false, note: failure(error) };
  }
  const body = state.hasText ? state.text : '';
  const text = body.slice(offset, limit);
  const truncated = body.length > limit;
  const note = state.missingCMap
    ? `Some text in this PDF uses an East Asian font encoding that Tabpass does not include, and is missing here. ${SCREENSHOT}`
    : state.hasText
      ? undefined
      : `This PDF has no text to read, so it is probably scanned. ${SCREENSHOT}`;
  return {
    format: 'pdf',
    text,
    truncated,
    pages: state.pages,
    ...(truncated ? { nextOffset: offset + text.length } : {}),
    ...(note ? { note } : {}),
  };
}

globalThis.__tabpassPdf ??= (args) => {
  const run = queue.then(() => read(args));
  queue = run.catch(() => undefined);
  return run;
};
