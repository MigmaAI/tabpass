import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [fixture, pageAgent] = await Promise.all([
  readFile(join(here, 'fixtures', 'display-contents.html'), 'utf8'),
  readFile(join(here, '../extension/public/content/page-agent.js'), 'utf8'),
]);
const transparentGif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
const browser = await chromium.launch({ headless: true });

try {
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

  const response = await page.evaluate(() => globalThis.__tabpassAgent.call('readPage', { includeHtml: true }));
  assert.equal(response.error, undefined, response.error);
  const evidence = response.value;
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
} finally {
  await browser.close();
}
