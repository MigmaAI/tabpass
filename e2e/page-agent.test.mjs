import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [fixture, formatsFixture, framedPage, pageAgent] = await Promise.all([
  readFile(join(here, 'fixtures', 'display-contents.html'), 'utf8'),
  readFile(join(here, 'fixtures', 'read-formats.html'), 'utf8'),
  readFile(join(here, 'fixtures', 'second.html'), 'utf8'),
  readFile(join(here, '../extension/public/content/page-agent.js'), 'utf8'),
]);
const transparentGif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
const browser = await chromium.launch({ headless: true });

async function read(page, args) {
  const response = await page.evaluate((input) => globalThis.__tabpassAgent.call('readPage', input), args);
  assert.equal(response.error, undefined, response.error);
  return response.value;
}

const SECRETS = /INLINE_SCRIPT_SECRET|META_CSRF_SECRET|HIDDEN_INPUT_SECRET|PASSWORD_SECRET|TEXTAREA_SECRET|DISPLAY_NONE_SECRET|HIDDEN_ROW_SECRET/;

try {
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.route('https://fixture.test/**', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
      } else {
        await route.fulfill({ status: 200, contentType: 'image/gif', body: transparentGif });
      }
    });
    await page.goto('https://fixture.test/display-contents.html');
    await page.addScriptTag({ content: pageAgent });

    const evidence = await read(page, { includeHtml: true });
    assert.match(evidence.text, /Trail Runner in Glacier Blue/);
    assert.match(evidence.text, /110,00 €/);
    assert.match(evidence.text, /Lightweight everyday trainers/);
    assert.match(evidence.html, /<h1>Trail Runner in Glacier Blue<\/h1>/);
    assert.match(evidence.html, /110,00 €/);
    for (const photo of ['front', 'side', 'back', 'sole', 'detail']) {
      assert.ok(evidence.html.includes(`https://fixture.test/products/trail-runner-${photo}.jpg`), `visible ${photo} image URL is preserved`);
    }
    assert.doesNotMatch(evidence.text, /DISPLAY_NONE_SECRET|ARIA_HIDDEN_SECRET/);
    assert.match(evidence.text, /EDITABLE_DOCUMENT_TEXT/, 'existing plaintext readers retain visible rich-text documents');
    assert.doesNotMatch(evidence.html, /DISPLAY_NONE_SECRET|ARIA_HIDDEN_SECRET|hidden-display|hidden-aria/);
    assert.doesNotMatch(evidence.html, /TEXTAREA_DRAFT_SECRET|EDITABLE_DOCUMENT_TEXT|<textarea/);
    console.log('display:contents extraction regression passed');
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.route('https://fixture.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/read-formats.html') await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: formatsFixture });
      else if (pathname === '/second.html') await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: framedPage });
      else await route.fulfill({ status: 200, contentType: 'image/gif', body: transparentGif });
    });
    await page.route('https://other.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>CROSS_SITE_FRAME_TEXT</p>' }));
    await page.route('https://tracker.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
    await page.goto('https://fixture.test/read-formats.html');
    await page.addScriptTag({ content: pageAgent });

    // Markdown is the default: nothing is capped short of maxChars, and truncation is never silent.
    const markdown = await read(page, { maxChars: 200000 });
    assert.equal(markdown.truncated, false);
    assert.match(markdown.text, /^# \[Linked heading\]\(https:\/\/fixture\.test\/article\)$/m, 'a link inside a heading keeps its URL');
    assert.match(markdown.text, /\*\*bold\*\*, \*italic\* and `inline code`/);
    assert.match(markdown.text, /^> Quoted line$/m);
    assert.match(markdown.text, /```js\nconst start = 1;/);
    assert.ok(markdown.text.includes('END_OF_LISTING'), 'a long code block is not cut at 5000 characters');
    assert.ok(markdown.text.includes('[row499](https://fixture.test/rows/499)'), 'a long table is not cut at 200 rows and cells keep their links');
    assert.ok(markdown.text.includes('LAZY_CELL_TEXT'), 'content-visibility:auto cells are not read as blank');
    assert.doesNotMatch(markdown.text, /^\|\s*\|\s*\|$/m, 'empty rows are dropped');
    assert.match(markdown.text, /^Layout left$/m, 'a layout table reads as blocks, not a one-row grid');
    assert.match(markdown.text, /^Layout nested$/m);
    assert.ok(markdown.text.includes('![Hero photo](https://fixture.test/hero.gif)'));
    assert.ok(markdown.text.includes('![Inline photo]'));
    assert.doesNotMatch(markdown.text, /data:image/, 'inline image data never reaches the agent');
    assert.ok(markdown.text.includes('Back to form'), 'a same-origin frame is read in place');
    assert.doesNotMatch(markdown.text, /CROSS_SITE_FRAME_TEXT/, 'a frame from another site stays behind its own permission');
    assert.deepEqual(markdown.frames, ['https://other.test/embed'], 'unread frames are named; tracking pixels are not');
    assert.doesNotMatch(markdown.text, SECRETS);
    assert.equal(markdown.format, 'markdown');

    const text = await read(page, { format: 'text', maxChars: 200000 });
    assert.equal(text.format, 'text');
    assert.match(text.text, /^Linked heading$/m);
    assert.match(text.text, /Some bold, italic and inline code text\./);
    assert.doesNotMatch(text.text, /\]\(|\*\*|^# |```|!\[/m);
    assert.ok(text.text.includes('END_OF_LISTING'));
    assert.doesNotMatch(text.text, SECRETS);

    const html = await read(page, { format: 'html', maxChars: 200000 });
    assert.equal(html.format, 'html');
    assert.equal(html.truncated, false);
    assert.match(html.text, /<nav id="site-nav" class="nav top">/);
    assert.match(html.text, /<h1 id="title" class="page-title"><a href="https:\/\/fixture\.test\/article">Linked heading<\/a><\/h1>/);
    assert.match(html.text, /<strong>bold<\/strong>/);
    assert.ok(html.text.includes('END_OF_LISTING'), 'html is bounded by maxChars, not 12000 characters');
    assert.ok(html.text.includes('Back to form'), 'html includes same-origin frames');
    assert.doesNotMatch(html.text, SECRETS);
    assert.doesNotMatch(html.text, /<script|<style|<input|<textarea|CROSS_SITE_FRAME_TEXT|data:image/);

    const bounded = await read(page, { format: 'html', maxChars: 2000 });
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.text.length <= 2000);
    assert.ok(bounded.nextOffset > 0);

    const evidence = await read(page, { includeHtml: true, maxChars: 200000 });
    assert.ok(evidence.html.length <= 12000, 'the includeHtml add-on keeps its bounded evidence size');
    assert.doesNotMatch(evidence.html, /<nav id=|class=/, 'the includeHtml add-on keeps its minimal attributes');

    const links = await read(page, { format: 'links' });
    assert.equal(links.format, 'links');
    assert.match(links.text, /^- \[Home\]\(https:\/\/fixture\.test\/home\)$/m);
    assert.equal(links.text.match(/\(https:\/\/fixture\.test\/home\)/g).length, 1, 'duplicate links are listed once');
    assert.ok(links.text.includes('[row499](https://fixture.test/rows/499)'));
    assert.doesNotMatch(links.text, /javascript:|hidden-link/);

    const images = await read(page, { format: 'images' });
    assert.equal(images.format, 'images');
    assert.match(images.text, /^- !\[Hero photo\]\(https:\/\/fixture\.test\/hero\.gif\) 320x200$/m);
    assert.doesNotMatch(images.text, /pixel\.gif|data:image/, 'tracking pixels and inline data are left out');

    const metadata = await read(page, { format: 'metadata' });
    const parsed = JSON.parse(metadata.text);
    assert.equal(metadata.format, 'metadata');
    assert.equal(parsed.lang, 'en');
    assert.equal(parsed.canonical, 'https://fixture.test/canonical');
    assert.equal(parsed.meta['og:title'], 'Open Graph title');
    assert.equal(parsed.meta['csrf-token'], undefined, 'token meta tags are left out');
    assert.equal(parsed.jsonLd[0].offers.price, '110.00');
    assert.ok(parsed.headings.includes('# Linked heading'));
    assert.ok(parsed.headings.includes('## Card two'));
    assert.doesNotMatch(metadata.text, SECRETS);

    const scoped = await read(page, { selector: '#cards .card' });
    assert.match(scoped.text, /^## Card one$/m);
    assert.match(scoped.text, /^## Card two$/m, 'every match is read');
    assert.doesNotMatch(scoped.text, /Linked heading|Home/);
    const scopedHtml = await read(page, { selector: 'h1', format: 'html' });
    assert.equal(scopedHtml.text, '<h1 id="title" class="page-title"><a href="https://fixture.test/article">Linked heading</a></h1>');
    const missing = await page.evaluate(() => globalThis.__tabpassAgent.call('readPage', { selector: '.nothing-here' }));
    assert.match(missing.error, /No element matches/);
    const invalid = await page.evaluate(() => globalThis.__tabpassAgent.call('readPage', { selector: '[[' }));
    assert.match(invalid.error, /not a valid CSS selector/);

    // Paging returns the same document, so a long page never has to be read twice.
    let offset = 0;
    let joined = '';
    for (let part = 0; part < 100; part += 1) {
      const chunk = await read(page, { maxChars: 9000, offset });
      joined += chunk.text;
      if (!chunk.truncated) break;
      assert.equal(chunk.nextOffset, joined.length);
      offset = chunk.nextOffset;
    }
    assert.equal(joined, markdown.text);
    assert.equal((await read(page, { offset: 90_000_000 })).text, '');

    console.log('read formats passed');
    await page.close();
  }

  // Tabs showing a file return that file, whole and unchanged.
  for (const [contentType, body] of [
    ['text/plain', `${'plain line\n'.repeat(3000)}PLAIN_END`],
    ['text/markdown', `# Title\n\n${'markdown line\n'.repeat(3000)}MARKDOWN_END`],
    ['application/json', JSON.stringify({ fill: 'j'.repeat(30000), end: 'JSON_END' })],
  ]) {
    const page = await browser.newPage();
    await page.route('https://fixture.test/**', (route) => route.fulfill({ status: 200, contentType, body }));
    await page.goto('https://fixture.test/file');
    await page.evaluate(pageAgent);
    const result = await read(page, { maxChars: 200000 });
    assert.equal(result.text, body, `${contentType} is returned exactly`);
    assert.equal(result.format, 'raw');
    assert.equal(result.contentType, contentType);
    assert.equal(result.truncated, false);
    const part = await read(page, { maxChars: 1000, offset: 500 });
    assert.equal(part.text, body.slice(500, 1500));
    assert.equal(part.truncated, true);
    assert.equal(part.nextOffset, 1500);
    await page.close();
    console.log(`raw ${contentType} passed`);
  }

  {
    const xml = '<?xml version="1.0"?><feed><entry id="1">XML_ENTRY</entry></feed>';
    const page = await browser.newPage();
    await page.route('https://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'application/xml', body: xml }));
    await page.goto('https://fixture.test/feed.xml');
    await page.evaluate(pageAgent);
    const result = await read(page, {});
    assert.equal(result.format, 'raw');
    assert.equal(result.text, '<feed><entry id="1">XML_ENTRY</entry></feed>', "the file, not Chrome's viewer around it");
    await page.close();
    console.log('raw xml passed');
  }

  {
    const page = await browser.newPage();
    await page.route('https://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: transparentGif }));
    await page.goto('https://fixture.test/photo.gif');
    await page.evaluate(pageAgent);
    const result = await read(page, {});
    assert.equal(result.text, '');
    assert.match(result.note, /image\/gif/, 'a tab without text says why, rather than returning a blank read');
    await page.close();
    console.log('non-text tab note passed');
  }
} finally {
  await browser.close();
}
