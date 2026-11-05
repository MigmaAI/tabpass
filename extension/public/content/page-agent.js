// Injected on demand into a tab's isolated world (never the page's own JS world), so pages cannot
// call it or see its state. The service worker reaches it with
//   chrome.scripting.executeScript({ func: (m, a) => globalThis.__tabpassAgent.call(m, a) })
// Element refs survive between calls in the same document, so `read_page` then `click` works.

(() => {
  if (globalThis.__tabpassAgent) return;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED',
    'HEAD', 'META', 'LINK', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION',
  ]);
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'HEADER', 'MAIN', 'NAV', 'P', 'SECTION', 'SUMMARY', 'CENTER',
    'TABLE', 'CAPTION', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
  ]);
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=switch]', '[role=tab]',
    '[role=menuitem]', '[role=option]', '[role=combobox]', '[role=textbox]', '[role=searchbox]',
    '[contenteditable=""]', '[contenteditable=true]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const KEY_CODES = {
    Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ' ': 32, Space: 32,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  };

  const refToElement = new Map();
  const elementToRef = new WeakMap();
  let nextRef = 1;

  // ---------- helpers ----------

  function isVisible(el) {
    if (el?.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkVisibilityCSS: true })) return false;
    } else {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.tagName === 'BODY';
  }

  // Layoutless wrappers still contain rendered content. Keep this separate
  // from actionable-element visibility: a zero-box wrapper is not clickable.
  function isReadableContainer(el) {
    if (isVisible(el)) return true;
    if (el?.nodeType !== Node.ELEMENT_NODE || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(el);
    return style.display === 'contents' && style.visibility !== 'hidden'
      && style.visibility !== 'collapse' && style.contentVisibility !== 'hidden';
  }

  function collapse(text) {
    return text.replace(/\s+/g, ' ');
  }

  function absoluteUrl(value, el) {
    try {
      return new URL(value, el?.baseURI ?? document.baseURI).href;
    } catch {
      return '';
    }
  }

  function* allElements(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node instanceof Element) {
        yield node;
        if (node.shadowRoot) yield* allElements(node.shadowRoot);
      }
      node = walker.nextNode();
    }
  }

  function refFor(el) {
    let ref = elementToRef.get(el);
    if (!ref) {
      ref = nextRef++;
      elementToRef.set(el, ref);
      refToElement.set(ref, new WeakRef(el));
    }
    return ref;
  }

  function accessibleName(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => el.getRootNode().getElementById(id)?.innerText ?? '')
        .join(' ')
        .trim();
      if (text) return text;
    }
    const aria = el.getAttribute('aria-label');
    if (aria?.trim()) return aria.trim();
    if (el.labels?.length) {
      const text = [...el.labels].map((label) => label.innerText).join(' ').trim();
      if (text) return text;
    }
    if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type)) return el.value;
    const placeholder = el.getAttribute('placeholder');
    const text = el.innerText?.trim();
    if (text) return text;
    if (placeholder) return placeholder;
    const img = el.querySelector?.('img[alt]');
    if (img?.alt) return img.alt;
    return el.getAttribute('title') ?? el.getAttribute('name') ?? '';
  }

  function roleOf(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName;
    if (tag === 'A') return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const type = el.type;
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return tag.toLowerCase();
  }

  function inViewport(rect) {
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }

  function describeElement(el) {
    const rect = el.getBoundingClientRect();
    const role = roleOf(el);
    const name = collapse(accessibleName(el)).trim().slice(0, 100);
    const parts = [`[ref=${refFor(el)}] ${role}`];
    if (name) parts.push(JSON.stringify(name));
    if (el instanceof HTMLInputElement && !['submit', 'button', 'reset'].includes(el.type)) {
      if (el.type === 'checkbox' || el.type === 'radio') parts.push(el.checked ? '(checked)' : '(unchecked)');
      else if (el.type === 'password') parts.push(el.value ? 'value=[hidden]' : 'value=""');
      else parts.push(`value=${JSON.stringify(el.value.slice(0, 100))}`);
      if (!['text', 'checkbox', 'radio'].includes(el.type)) parts.push(`(type=${el.type})`);
    } else if (el instanceof HTMLTextAreaElement) {
      parts.push(`value=${JSON.stringify(el.value.slice(0, 100))}`);
    } else if (el instanceof HTMLSelectElement) {
      parts.push(`selected=${JSON.stringify(el.selectedOptions[0]?.text ?? '')}`);
      const options = [...el.options].slice(0, 12).map((option) => option.text.trim());
      parts.push(`options=${JSON.stringify(options)}`);
    }
    if (el.getAttribute('aria-expanded')) parts.push(`(expanded=${el.getAttribute('aria-expanded')})`);
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('(disabled)');
    if (el instanceof HTMLAnchorElement && el.href && !el.href.startsWith('javascript:')) parts.push(`→ ${el.href}`);
    if (!inViewport(rect)) parts.push('(off-screen)');
    return parts.join(' ');
  }

  function interactiveElements(max) {
    const found = [];
    for (const el of allElements(document.body ?? document.documentElement)) {
      if (!el.matches(INTERACTIVE_SELECTOR) || !isVisible(el)) continue;
      found.push(el);
    }
    // On-screen first, then document order, so the cap keeps what the user is looking at.
    const onScreen = found.filter((el) => inViewport(el.getBoundingClientRect()));
    const offScreen = found.filter((el) => !inViewport(el.getBoundingClientRect()));
    const chosen = [...onScreen, ...offScreen].slice(0, max);
    return { lines: chosen.map(describeElement), total: found.length };
  }

  function resolveTarget({ ref, selector, text }) {
    if (typeof ref === 'number') {
      const el = refToElement.get(ref)?.deref();
      if (!el || !el.isConnected) throw new Error(`ref ${ref} is gone (the page changed). Call read_page with interactive=true again.`);
      return el;
    }
    if (selector) {
      let el;
      try {
        el = document.querySelector(selector);
      } catch {
        throw new Error(`"${selector}" is not a valid CSS selector.`);
      }
      if (!el) throw new Error(`No element matches "${selector}".`);
      return el;
    }
    if (text) {
      const wanted = text.trim().toLowerCase();
      const candidates = [];
      for (const el of allElements(document.body)) {
        if (!el.matches(INTERACTIVE_SELECTOR) || !isVisible(el)) continue;
        const name = collapse(accessibleName(el)).trim().toLowerCase();
        if (name === wanted) candidates.unshift(el);
        else if (name.includes(wanted)) candidates.push(el);
      }
      if (!candidates.length) throw new Error(`No button or link with text "${text}". Use read_page with interactive=true to find it.`);
      return candidates.find((el) => inViewport(el.getBoundingClientRect())) ?? candidates[0];
    }
    throw new Error('Pass a ref, a selector or text.');
  }

  // ---------- reading ----------

  const IMAGE_MIN_PX = 16;
  const FRAME_MIN_WIDTH = 100;
  const FRAME_MIN_HEIGHT = 50;
  const EVIDENCE_HTML_CHARS = 12000;
  const EVIDENCE_HTML_TAGS = new Set('a abbr address article aside b blockquote br button caption center code dd details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img li main nav ol p pre section small span strong sub summary sup table tbody td th thead tr ul'.split(' '));
  const EVIDENCE_HTML_ATTRIBUTES = ['alt', 'title', 'aria-label', 'role', 'colspan', 'rowspan'];
  const FULL_HTML_ATTRIBUTES = ['id', 'class', 'style', 'lang', 'dir', ...EVIDENCE_HTML_ATTRIBUTES, 'width', 'height', 'datetime'];
  const VOID_TAGS = new Set(['area', 'br', 'col', 'hr', 'img', 'source', 'track', 'wbr']);
  // Apps keep session values in meta tags; these are never page content.
  const SECRET_META = /csrf|xsrf|token|nonce|secret|session|api[-_]?key/i;

  // Frames from other sites stay behind their own site permission, so they are named, not read.
  // Tracking pixels and slots too small to hold content are not worth naming.
  function noteUnreadFrame(frame, unread) {
    const rect = frame.getBoundingClientRect();
    if (rect.width < FRAME_MIN_WIDTH || rect.height < FRAME_MIN_HEIGHT || !isVisible(frame)) return;
    unread.add(/^https?:/i.test(frame.src) ? frame.src : 'an embedded frame without an address');
  }

  function isDataTable(el) {
    if (el.querySelector('table') || el.rows.length < 2) return false;
    for (const row of el.rows) if (row.cells.length > 1) return true;
    return false;
  }

  function pageText(roots, maxChars, plain, unread) {
    let lines = [];
    let inline = '';
    let bare = plain;
    let nested = 0;
    let budget = maxChars;
    let truncated = false;

    const count = (line) => {
      if (!nested) budget -= line.length + 1;
    };
    const flush = () => {
      const line = collapse(inline).trim();
      if (line) {
        lines.push(line);
        count(line);
      }
      inline = '';
    };
    const push = (line) => {
      flush();
      if (line) {
        lines.push(line);
        count(line);
      }
    };
    const walkChildren = (el, listDepth) => {
      for (const child of el.childNodes) walk(child, listDepth);
      if (el.shadowRoot) for (const child of el.shadowRoot.childNodes) walk(child, listDepth);
    };

    // An element's content as one line, by the same visibility rules as everything else. innerText
    // would read as blank for content the browser has skipped rendering, and would lose its links.
    const oneLine = (el, plainText = bare) => {
      const outer = { lines, inline, bare };
      lines = [];
      inline = '';
      bare = plainText;
      nested += 1;
      walkChildren(el, 0);
      flush();
      const line = collapse(lines.join(' ')).trim();
      nested -= 1;
      ({ lines, inline, bare } = outer);
      return line;
    };

    const emphasis = (el, mark, listDepth) => {
      const start = inline.length;
      const before = lines.length;
      walkChildren(el, listDepth);
      if (bare || lines.length !== before) return; // a block inside: leave it as it was written
      const inner = inline.slice(start);
      const core = inner.trim();
      if (core) inline = inline.slice(0, start) + inner.replace(core, () => `${mark}${core}${mark}`);
    };

    const table = (el) => {
      flush();
      let width = 0;
      for (const row of el.rows) width = Math.max(width, row.cells.length);
      let header = true;
      for (const row of el.rows) {
        if (budget <= 0) {
          truncated = true;
          return;
        }
        if (!isReadableContainer(row)) continue;
        const cells = [...row.cells].filter(isReadableContainer).map((cell) => oneLine(cell));
        if (!cells.some(Boolean)) continue;
        if (bare) {
          push(cells.join('\t'));
          continue;
        }
        const padded = [...cells, ...Array(width - cells.length).fill('')].map((cell) => cell.replace(/\|/g, '\\|'));
        push(`| ${padded.join(' | ')} |`);
        if (header) push(`|${' --- |'.repeat(width)}`);
        header = false;
      }
    };

    const walk = (node, listDepth) => {
      if (budget <= 0) {
        truncated = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        inline += collapse(node.textContent ?? '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      const tag = el.tagName.toUpperCase();
      if (!isReadableContainer(el)) return;
      if (tag === 'IFRAME') {
        const body = el.contentDocument?.body;
        if (body) {
          flush();
          walk(body, listDepth);
          flush();
        } else {
          noteUnreadFrame(el, unread);
        }
        return;
      }
      if (SKIP_TAGS.has(tag)) return;

      const heading = /^H([1-6])$/.exec(tag);
      if (heading) {
        const title = oneLine(el);
        if (title) push(bare ? title : `${'#'.repeat(Number(heading[1]))} ${title}`);
        return;
      }
      switch (tag) {
        case 'BR':
          flush();
          return;
        case 'HR':
          if (!bare) push('---');
          return;
        case 'PRE': {
          const code = el.innerText || el.textContent || '';
          const language = /language-([\w+-]+)/.exec(`${el.className} ${el.querySelector('code')?.className ?? ''}`)?.[1] ?? '';
          push(bare ? code : `\`\`\`${language}\n${code}\n\`\`\``);
          return;
        }
        case 'TABLE':
          if (!isDataTable(el)) break;
          table(el);
          return;
        case 'IMG': {
          const alt = el.getAttribute('alt')?.trim();
          if (bare || !alt || el.width < 60) return;
          const src = el.currentSrc || el.src;
          inline += src.startsWith('data:') ? ` ![${alt}] ` : ` ![${alt}](${src}) `;
          return;
        }
        case 'A': {
          const href = el.getAttribute('href');
          if (bare || !href || href.startsWith('#') || /^javascript:/i.test(href)) break;
          const label = oneLine(el, true) || el.getAttribute('aria-label')?.trim() || el.querySelector('img[alt]')?.getAttribute('alt')?.trim();
          if (!label) break;
          inline += ` [${label}](${absoluteUrl(href, el)}) `;
          return;
        }
        case 'B':
        case 'STRONG':
          emphasis(el, '**', listDepth);
          return;
        case 'I':
        case 'EM':
          emphasis(el, '*', listDepth);
          return;
        case 'S':
        case 'DEL':
          emphasis(el, '~~', listDepth);
          return;
        case 'CODE':
        case 'KBD':
        case 'SAMP':
          emphasis(el, '`', listDepth);
          return;
        case 'BLOCKQUOTE': {
          flush();
          const before = lines.length;
          walkChildren(el, listDepth);
          flush();
          if (!bare) for (let i = before; i < lines.length; i += 1) lines[i] = `> ${lines[i]}`;
          return;
        }
        case 'UL':
        case 'OL': {
          flush();
          let index = 1;
          for (const child of el.children) {
            if (child.tagName !== 'LI' || !isReadableContainer(child)) continue;
            const marker = tag === 'OL' ? `${index++}.` : '-';
            const before = lines.length;
            walkChildren(child, listDepth + 1);
            flush();
            const indent = '  '.repeat(listDepth);
            if (lines.length > before) lines[before] = `${indent}${marker} ${lines[before]}`;
          }
          return;
        }
        default:
          break;
      }

      const block = BLOCK_TAGS.has(tag) || tag === 'LI';
      if (block) flush();
      walkChildren(el, listDepth);
      if (block) flush();
    };

    for (const root of roots) {
      walk(root, 0);
      flush();
    }
    return { body: lines.join('\n'), cut: truncated };
  }

  function pageInfo() {
    const meta = (name) =>
      document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content') ?? '';
    return {
      title: document.title,
      url: location.href,
      lang: document.documentElement.lang || '',
      description: meta('description') || meta('og:description'),
    };
  }

  // Visible structure only. Build an allowlisted representation instead of cloning live HTML with
  // its scripts, state, events or form data. `full` keeps real tag names, id, class and style, reads
  // same-origin frames and is bounded only by maxChars; a stopped full read is cut mid-document, so
  // the same prefix comes back at any larger limit and paging by offset stays exact.
  function pageHtml(roots, { maxChars = EVIDENCE_HTML_CHARS, full = false, unread } = {}) {
    const attributes = full ? FULL_HTML_ATTRIBUTES : EVIDENCE_HTML_ATTRIBUTES;
    const maxNodes = full ? Infinity : 1500;
    const maxDepth = full ? 1000 : 60;
    const pieces = [];
    let length = 0;
    let closingChars = 0;
    let nodes = 0;
    let truncated = false;
    const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const append = (value) => {
      if (full) {
        pieces.push(value);
        length += value.length;
        if (length > maxChars) truncated = true;
        return true;
      }
      if (length + value.length + closingChars > maxChars) { truncated = true; return false; }
      pieces.push(value);
      length += value.length;
      return true;
    };
    const tagFor = (node) => {
      if (full) return /^[a-z][a-z0-9-]*$/.test(node.localName) ? node.localName : 'div';
      return EVIDENCE_HTML_TAGS.has(node.localName) ? node.localName : 'div';
    };
    const walk = (node, depth, preformatted) => {
      if (truncated) return;
      if (++nodes > maxNodes || depth > maxDepth) { truncated = true; return; }
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent ?? '';
        append(escape(full && preformatted ? value : collapse(value)));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (!isReadableContainer(node)) return;
      if (full && node.localName === 'iframe') {
        const body = node.contentDocument?.body;
        if (body) {
          if (isReadableContainer(body)) for (const child of body.childNodes) walk(child, depth + 1, false);
        } else noteUnreadFrame(node, unread);
        return;
      }
      if (SKIP_TAGS.has(node.tagName.toUpperCase()) || node.isContentEditable) return;
      const tag = tagFor(node);
      const attrs = [];
      for (const name of attributes) {
        const value = node.getAttribute(name);
        if (value) attrs.push(`${name}="${escape(value.slice(0, full ? 2000 : 300))}"`);
      }
      const resource = tag === 'img' ? ['src', node.currentSrc || node.src] : tag === 'a' ? ['href', node.href] : null;
      if (resource && /^https?:\/\//i.test(resource[1]) && resource[1].length <= 2000) {
        attrs.push(`${resource[0]}="${escape(resource[1])}"`);
      }
      const close = VOID_TAGS.has(tag) ? '' : `</${tag}>`;
      closingChars += close.length;
      if (!append(`<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`)) { closingChars -= close.length; return; }
      if (close) {
        const inner = preformatted || tag === 'pre';
        for (const child of node.childNodes) walk(child, depth + 1, inner);
        if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) walk(child, depth + 1, inner);
        closingChars -= close.length;
        pieces.push(close);
        length += close.length;
      }
    };
    for (const root of roots) walk(root, 0, false);
    return { html: pieces.join(''), htmlTruncated: truncated };
  }

  // Prune hidden subtrees before entering frames or shadow roots. Frame elements belong to
  // another Window, so use nodeType rather than instanceof Element when traversing them.
  function* readableElements(root, unread) {
    if (root.nodeType !== Node.ELEMENT_NODE || !isReadableContainer(root)) return;
    if (root.localName === 'iframe') {
      const body = root.contentDocument?.body;
      if (body) yield* readableElements(body, unread);
      else noteUnreadFrame(root, unread);
      return;
    }
    if (SKIP_TAGS.has(root.tagName.toUpperCase())) return;
    yield root;
    for (const child of root.children) yield* readableElements(child, unread);
    if (root.shadowRoot) for (const child of root.shadowRoot.children) yield* readableElements(child, unread);
  }

  /** Every visible link, once. Stops at maxChars. */
  function pageLinks(roots, maxChars, unread) {
    const seen = new Set();
    const lines = [];
    let length = 0;
    for (const root of roots) {
      for (const el of readableElements(root, unread)) {
        if (length > maxChars) return { body: lines.join('\n'), cut: true };
        if (el.localName !== 'a' || typeof el.href !== 'string' || !/^(https?|mailto|tel):/i.test(el.href)) continue;
        if (seen.has(el.href) || !isVisible(el)) continue;
        seen.add(el.href);
        const line = `- [${collapse(accessibleName(el)).trim()}](${el.href})`;
        lines.push(line);
        length += line.length + 1;
      }
    }
    return { body: lines.join('\n'), cut: false };
  }

  /** Every visible image with an address, once, with its size on the page. Stops at maxChars. */
  function pageImages(roots, maxChars, unread) {
    const seen = new Set();
    const lines = [];
    let length = 0;
    for (const root of roots) {
      for (const el of readableElements(root, unread)) {
        if (length > maxChars) return { body: lines.join('\n'), cut: true };
        if (el.localName !== 'img') continue;
        const src = el.currentSrc || el.src;
        if (!/^https?:/i.test(src) || seen.has(src) || !isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < IMAGE_MIN_PX || rect.height < IMAGE_MIN_PX) continue;
        seen.add(src);
        const line = `- ![${collapse(el.alt).trim()}](${src}) ${Math.round(rect.width)}x${Math.round(rect.height)}`;
        lines.push(line);
        length += line.length + 1;
      }
    }
    return { body: lines.join('\n'), cut: false };
  }

  /** What the page says about itself: meta tags, JSON-LD and its outline. */
  function pageMetadata() {
    const meta = {};
    for (const tag of document.querySelectorAll('meta[name], meta[property], meta[itemprop]')) {
      const name = tag.getAttribute('property') || tag.getAttribute('name') || tag.getAttribute('itemprop');
      const content = tag.getAttribute('content');
      if (name && content && !SECRET_META.test(name)) meta[name] = content;
    }
    const jsonLd = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        jsonLd.push(JSON.parse(script.textContent));
      } catch {
        // Pages ship broken JSON-LD; the rest is still useful.
      }
    }
    const headings = [];
    for (const heading of document.querySelectorAll('h1, h2, h3')) {
      const title = collapse(heading.textContent ?? '').trim();
      if (title && isVisible(heading)) headings.push(`${'#'.repeat(Number(heading.localName[1]))} ${title}`);
    }
    const href = (selector) => document.querySelector(selector)?.href ?? null;
    return JSON.stringify({
      title: document.title,
      url: location.href,
      lang: document.documentElement.lang || null,
      canonical: href('link[rel="canonical"]'),
      feed: href('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]'),
      meta,
      jsonLd,
      headings,
    }, null, 2);
  }

  // A tab showing a file, not a web page. Chrome wraps text files in a <pre>, so the file comes
  // back exactly as it was served. Null for a web page.
  function fileInTab() {
    const contentType = (document.contentType || '').toLowerCase();
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') return null;
    if (/[/+]xml$/.test(contentType)) {
      // Chrome's XML viewer replaces the document and keeps the original in this element.
      const source = document.getElementById('webkit-xml-viewer-source-xml')?.innerHTML;
      return { contentType, text: source ?? new XMLSerializer().serializeToString(document) };
    }
    if (/^text\/|[/+]json$|javascript|yaml|toml/.test(contentType)) {
      return { contentType, text: (document.body?.querySelector(':scope > pre') ?? document.body)?.textContent ?? '' };
    }
    // A PDF's text comes from pdf.js, which lib/readers.js injects only when a PDF is read.
    if (contentType === 'application/pdf') return { contentType, text: '' };
    return {
      contentType,
      text: '',
      note: `This tab shows ${contentType}, which has no text to read. Use screenshot to see it.`,
    };
  }

  function rootsFor(selector) {
    if (!selector) return document.body ? [document.body] : [];
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      throw new Error(`"${selector}" is not a valid CSS selector.`);
    }
    if (!matches.length) throw new Error(`No element matches "${selector}".`);
    // A match inside another match would otherwise be read twice.
    const matched = new Set(matches);
    return [...matched].filter((el) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (matched.has(parent) || !isReadableContainer(parent)) return false;
      }
      return true;
    });
  }

  function renderPage(format, roots, limit, unread) {
    switch (format) {
      case 'text':
        return pageText(roots, limit, true, unread);
      case 'html': {
        const { html, htmlTruncated } = pageHtml(roots, { maxChars: limit, full: true, unread });
        return { body: html, cut: htmlTruncated };
      }
      case 'links':
        return pageLinks(roots, limit, unread);
      case 'images':
        return pageImages(roots, limit, unread);
      case 'metadata':
        return { body: pageMetadata(), cut: false };
      default:
        return pageText(roots, limit, false, unread);
    }
  }

  function readPage({ maxChars = 40000, offset = 0, format = 'markdown', selector, interactive = false, includeHtml = false } = {}) {
    const limit = offset + maxChars;
    const unread = new Set();
    const file = fileInTab();
    const roots = file ? rootsFor() : rootsFor(selector);
    const { body, cut } = file ? { body: file.text, cut: false } : renderPage(format, roots, limit, unread);
    const text = body.slice(offset, limit);
    const truncated = cut || body.length > limit;
    const result = {
      ...pageInfo(),
      format: file ? 'raw' : format,
      text,
      truncated,
      ...(truncated ? { nextOffset: offset + text.length } : {}),
      ...(unread.size ? { frames: [...unread] } : {}),
      ...(file ? { contentType: file.contentType } : {}),
      ...(file?.note ? { note: file.note } : {}),
    };
    if (includeHtml) Object.assign(result, pageHtml(roots));
    if (interactive) {
      const { lines, total } = interactiveElements(250);
      result.elements = lines;
      result.elementsTotal = total;
    }
    return result;
  }

  function selection() {
    const text = getSelection()?.toString() ?? '';
    const active = document.activeElement;
    // Text selected inside a field is not part of getSelection().
    if (!text && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      const { selectionStart, selectionEnd, value } = active;
      if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) {
        return { ...pageInfo(), text: value.slice(selectionStart, selectionEnd) };
      }
    }
    return { ...pageInfo(), text };
  }

  // ---------- acting ----------

  function pointerSequence(el) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      view: window,
    };
    const pointer = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerover', pointer));
    el.dispatchEvent(new MouseEvent('mouseover', init));
    el.dispatchEvent(new PointerEvent('pointerdown', pointer));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', init));
  }

  function click(args) {
    const el = resolveTarget(args);
    if (el.disabled || el.matches(':disabled')) throw new Error('That element is disabled.');
    const label = describeElement(el);
    pointerSequence(el);
    // Read after the pointer events: pages such as webmail rewrite the address on mousedown.
    const link = el.closest('a[href]');
    let event;
    const observe = (clickEvent) => {
      if (!event && clickEvent.composedPath().includes(el)) event = clickEvent;
    };
    window.addEventListener('click', observe, true);
    try {
      // Keep native activation behavior, including its guard against recursive .click() calls.
      if (typeof el.click === 'function') el.click();
      else {
        event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window });
        el.dispatchEvent(event);
      }
    } finally {
      window.removeEventListener('click', observe, true);
    }
    // A canceled click may open a confirmation or handle navigation itself. Never bypass it
    // with a worker-created tab, even if the page's own window.open was blocked by Chrome.
    const linkUrl = typeof link?.target === 'string' && /^_blank$/i.test(link.target) && /^https?:/i.test(link.href) ? link.href : null;
    return { clicked: label, opensTab: event && !event.defaultPrevented ? linkUrl : null, linkUrl };
  }

  function keyInit(key) {
    const code = KEY_CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const codeName = key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key;
    return { key: key === 'Space' ? ' ' : key, code: codeName, keyCode: code, which: code, bubbles: true, cancelable: true, composed: true };
  }

  function dispatchKey(target, key) {
    const init = keyInit(key);
    const down = new KeyboardEvent('keydown', init);
    target.dispatchEvent(down);
    if (key.length === 1 || key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    return down.defaultPrevented;
  }

  function pressEnter(el) {
    const handled = dispatchKey(el, 'Enter');
    // Synthetic key events do not trigger implicit form submission; do it unless the page handled Enter.
    if (!handled && el.form && !(el instanceof HTMLTextAreaElement)) el.form.requestSubmit();
  }

  function focusNext(backwards) {
    const focusable = [...allElements(document.body)].filter(
      (el) => el.matches(INTERACTIVE_SELECTOR) && !el.disabled && el.tabIndex >= 0 && isVisible(el)
    );
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement);
    const next = focusable[(index + (backwards ? -1 : 1) + focusable.length) % focusable.length];
    next.focus();
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }

  function type({ ref, selector, text, clear = true, submit = false }) {
    const el = resolveTarget({ ref, selector });
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });

    if (el instanceof HTMLSelectElement) {
      const wanted = text.trim().toLowerCase();
      const option =
        [...el.options].find((o) => o.value.toLowerCase() === wanted || o.text.trim().toLowerCase() === wanted) ??
        [...el.options].find((o) => o.text.trim().toLowerCase().includes(wanted));
      if (!option) throw new Error(`No option "${text}". Options: ${[...el.options].map((o) => o.text.trim()).join(', ')}`);
      el.value = option.value;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: `selected "${option.text.trim()}"` };
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (['checkbox', 'radio', 'submit', 'button', 'file', 'image', 'reset'].includes(el.type)) {
        throw new Error(`That is a ${el.type} input; use click instead.`);
      }
      setNativeValue(el, clear ? text : el.value + text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      if (!clear) range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand('insertText', false, text)) {
        el.textContent = clear ? text : el.textContent + text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      }
    } else {
      throw new Error('That element is not a text field. Use read_page with interactive=true to find the field.');
    }

    if (submit) pressEnter(el);
    return { typed: describeElement(el) };
  }

  function pressKey({ key }) {
    const target = document.activeElement ?? document.body;
    if (key === 'Tab' || key === 'Shift+Tab') {
      const handled = dispatchKey(target, 'Tab');
      if (!handled) focusNext(key === 'Shift+Tab');
    } else if (key === 'Enter') {
      pressEnter(target);
    } else {
      dispatchKey(target, key);
    }
    const focused = document.activeElement;
    return { focused: focused && focused !== document.body ? describeElement(focused) : 'page' };
  }

  function scrollContainer() {
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollHeight > innerHeight + 5) return null; // the window scrolls
    let best = null;
    let bestArea = 0;
    for (const el of allElements(document.body)) {
      if (el.scrollHeight <= el.clientHeight + 5) continue;
      const overflow = getComputedStyle(el).overflowY;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best;
  }

  function scroll({ direction = 'down', pixels, ref }) {
    if (typeof ref === 'number') {
      resolveTarget({ ref }).scrollIntoView({ block: 'center', behavior: 'instant' });
    } else {
      const container = scrollContainer();
      const target = container ?? window;
      const height = container ? container.clientHeight : innerHeight;
      const step = pixels ?? Math.round(height * 0.85);
      const max = container ? container.scrollHeight : document.documentElement.scrollHeight;
      if (direction === 'top') target.scrollTo({ top: 0, behavior: 'instant' });
      else if (direction === 'bottom') target.scrollTo({ top: max, behavior: 'instant' });
      else target.scrollBy({ top: direction === 'up' ? -step : step, behavior: 'instant' });
    }
    const container = scrollContainer();
    return {
      scrollY: Math.round(container ? container.scrollTop : scrollY),
      scrollHeight: container ? container.scrollHeight : document.documentElement.scrollHeight,
      viewportHeight: container ? container.clientHeight : innerHeight,
    };
  }

  function moveInHistory({ direction }) {
    // Deferred so the result gets back to the extension before the document unloads.
    setTimeout(() => (direction === 'forward' ? history.forward() : history.back()), 0);
    return {};
  }

  async function waitForText({ text, timeoutMs = 10000 }) {
    const wanted = text.toLowerCase();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((document.body?.innerText ?? '').toLowerCase().includes(wanted)) return { found: true };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { found: false };
  }

  // ---------- design ----------

  function parseColor(value) {
    const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(value ?? '');
    if (!match) return null;
    let alpha = match[4] === undefined ? 1 : parseFloat(match[4]);
    if (match[4]?.endsWith('%')) alpha /= 100;
    if (alpha < 0.15) return null;
    const hex = [match[1], match[2], match[3]]
      .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  }

  function saturationLightness(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    return { s, l };
  }

  function tally(map, key, weight) {
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + weight);
  }

  function ranked(map, limit, total) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, weight]) => (total ? { value, share: Math.round((weight / total) * 1000) / 10 } : { value, uses: weight }));
  }

  function typeStyle(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      sample: collapse(el.innerText ?? '').trim().slice(0, 60),
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      color: parseColor(cs.color),
    };
  }

  function firstVisible(selector) {
    for (const el of document.querySelectorAll(selector)) {
      if (isVisible(el) && collapse(el.innerText ?? '').trim()) return el;
    }
    return null;
  }

  function hasOwnText(el) {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) return child.textContent.trim().length;
    }
    return 0;
  }

  function extractDesign() {
    const backgrounds = new Map();
    const textColors = new Map();
    const accents = new Map();
    const fonts = new Map();
    const radii = new Map();
    const widths = new Map();
    const gradients = new Set();
    const bgImages = [];
    let bgTotal = 0;
    let textTotal = 0;
    let scanned = 0;

    const rootBg = parseColor(getComputedStyle(document.body).backgroundColor) ??
      parseColor(getComputedStyle(document.documentElement).backgroundColor) ?? '#ffffff';
    const viewportArea = innerWidth * Math.max(innerHeight, document.documentElement.scrollHeight);
    tally(backgrounds, rootBg, viewportArea * 0.25);
    bgTotal += viewportArea * 0.25;

    for (const el of allElements(document.body)) {
      if (scanned++ > 6000) break;
      if (el instanceof SVGElement || (SKIP_TAGS.has(el.tagName) && el.tagName !== 'INPUT')) continue;
      if (!isVisible(el)) continue;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const area = Math.min(rect.width * rect.height, viewportArea);

      const bg = parseColor(cs.backgroundColor);
      if (bg && area > 0) {
        tally(backgrounds, bg, area);
        bgTotal += area;
        const { s, l } = saturationLightness(bg);
        if (s > 0.35 && l > 0.15 && l < 0.85) tally(accents, bg, 1 + area / 50000);
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        if (cs.backgroundImage.includes('gradient') && gradients.size < 6) gradients.add(cs.backgroundImage.slice(0, 300));
        const url = /url\(["']?([^"')]+)["']?\)/.exec(cs.backgroundImage)?.[1];
        if (url && rect.width >= 300 && rect.height >= 150) bgImages.push({ src: absoluteUrl(url), width: Math.round(rect.width), height: Math.round(rect.height) });
      }
      const ownText = hasOwnText(el);
      if (ownText) {
        const color = parseColor(cs.color);
        tally(textColors, color, ownText);
        textTotal += ownText;
        tally(fonts, cs.fontFamily, ownText);
        if (el.closest('a, button') && color) {
          const { s, l } = saturationLightness(color);
          if (s > 0.35 && l > 0.15 && l < 0.85) tally(accents, color, 1);
        }
      }
      const radius = cs.borderTopLeftRadius;
      if (radius && radius !== '0px' && (bg || cs.borderTopStyle !== 'none' || el.tagName === 'IMG')) tally(radii, radius, 1);
      if (rect.width >= 560 && rect.width <= 1600 && rect.height > 120 && rect.left > 8) {
        const centered = Math.abs(rect.left - (document.documentElement.clientWidth - rect.right)) < 4;
        if (centered) tally(widths, Math.round(rect.width), 1);
      }
    }

    const buttons = [];
    const seenButtons = new Set();
    for (const el of document.querySelectorAll('button, a, input[type=submit], [role=button]')) {
      if (buttons.length >= 6 || !isVisible(el)) continue;
      const cs = getComputedStyle(el);
      const bg = parseColor(cs.backgroundColor);
      const bordered = cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0;
      if (!bg && !bordered) continue;
      const text = collapse(el.innerText ?? el.value ?? '').trim().slice(0, 40);
      if (!text) continue;
      const key = `${bg}|${cs.color}|${cs.borderTopLeftRadius}|${bordered}`;
      if (seenButtons.has(key)) continue;
      seenButtons.add(key);
      buttons.push({
        text,
        background: bg,
        color: parseColor(cs.color),
        border: bordered ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${parseColor(cs.borderTopColor)}` : null,
        radius: cs.borderTopLeftRadius,
        padding: cs.padding,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        textTransform: cs.textTransform,
      });
    }

    let logo = null;
    for (const el of document.querySelectorAll(
      'header img, header svg, [class*="logo" i] img, [id*="logo" i] img, img[alt*="logo" i], img[src*="logo" i], [class*="logo" i] svg, a[href="/"] img, a[href="/"] svg'
    )) {
      const rect = el.getBoundingClientRect();
      if (!isVisible(el) || rect.top > 400 || rect.width < 16) continue;
      logo =
        el.tagName === 'IMG'
          ? { src: el.currentSrc || el.src, alt: el.alt, width: Math.round(rect.width), height: Math.round(rect.height) }
          : { svg: el.outerHTML.slice(0, 6000), width: Math.round(rect.width), height: Math.round(rect.height) };
      break;
    }

    const images = [...document.images]
      .filter((img) => isVisible(img) && img.getBoundingClientRect().width >= 150 && img.getBoundingClientRect().height >= 100)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        return { src: img.currentSrc || img.src, alt: img.alt, width: Math.round(rect.width), height: Math.round(rect.height) };
      })
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, 8);

    const fontSources = [
      ...new Set(
        [...document.querySelectorAll('link[href*="fonts.googleapis.com"], link[href*="use.typekit.net"], link[href*="fonts.bunny.net"]')].map(
          (link) => link.href
        )
      ),
    ];
    const loadedFaces = [...new Set([...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, '')))];
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') ?? null;
    const icon = document.querySelector('link[rel~="icon"][sizes="192x192"], link[rel="apple-touch-icon"], link[rel~="icon"]');

    return {
      url: location.href,
      title: document.title,
      siteName: meta('meta[property="og:site_name"]'),
      themeColor: meta('meta[name="theme-color"]'),
      ogImage: meta('meta[property="og:image"]'),
      favicon: icon ? absoluteUrl(icon.getAttribute('href')) : null,
      colors: {
        pageBackground: rootBg,
        backgrounds: ranked(backgrounds, 8, bgTotal),
        text: ranked(textColors, 6, textTotal),
        accents: ranked(accents, 6),
        gradients: [...gradients],
      },
      fonts: ranked(fonts, 6, textTotal),
      loadedFontFaces: loadedFaces.slice(0, 12),
      fontSources,
      typeScale: {
        h1: typeStyle(firstVisible('h1')),
        h2: typeStyle(firstVisible('h2')),
        h3: typeStyle(firstVisible('h3')),
        body: typeStyle(firstVisible('main p, article p, p')),
        link: typeStyle(firstVisible('main a, p a, a')),
      },
      buttons,
      radii: ranked(radii, 6),
      contentWidth: ranked(widths, 3).map((entry) => `${entry.value}px`),
      logo,
      images,
      backgroundImages: bgImages.slice(0, 5),
    };
  }

  // ---------- indicator ----------

  let indicatorTimer = null;

  function showActivity({ label }) {
    let host = document.getElementById('__tabpass-indicator');
    if (!host) {
      host = document.createElement('div');
      host.id = '__tabpass-indicator';
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .frame { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
            box-shadow: inset 0 0 0 3px rgba(37, 99, 235, 0.85); transition: opacity 300ms ease; }
          .label { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
            font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #fafafa; background: #18181b; padding: 8px 12px; border-radius: 999px; white-space: nowrap; }
        </style>
        <div class="frame"><div class="label"></div></div>`;
      (document.body ?? document.documentElement).appendChild(host);
      host.__shadow = shadow;
    }
    const shadow = host.__shadow;
    shadow.querySelector('.label').textContent = `${label} is using this tab`;
    shadow.querySelector('.frame').style.opacity = '1';
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => {
      shadow.querySelector('.frame').style.opacity = '0';
    }, 2500);
    return {};
  }

  async function fetchText({ url }) {
    const response = await fetch(url, { credentials: 'include' });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || /text\/html|application\/xhtml\+xml/i.test(type)
      || (response.url && new URL(response.url).hostname === 'accounts.google.com')) throw new Error(`Export failed (${response.status}).`);
    return { text: await response.text() };
  }

  const methods = {
    readPage,
    readPdf: (args) => globalThis.__tabpassPdf?.(args) ?? null,
    selection,
    click,
    type,
    pressKey,
    scroll,
    waitForText,
    extractDesign,
    showActivity,
    fetchText,
    history: moveInHistory,
    info: pageInfo,
  };

  globalThis.__tabpassAgent = {
    async call(method, args) {
      const fn = methods[method];
      if (!fn) return { error: `Unknown page method ${method}` };
      try {
        return { value: await fn(args ?? {}) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
})();
