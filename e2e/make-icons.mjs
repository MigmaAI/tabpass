// Renders extension/public/icons/*.png from one SVG. Run: cd e2e && yarn icons
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" rx="28" fill="#cb593f"/>
  <rect x="28" y="25" width="52" height="61" rx="9" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="8"/>
  <rect x="48" y="43" width="52" height="61" rx="9" fill="#cb593f" stroke="#fff" stroke-width="8"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await mkdir(join(root, 'extension/public/icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${SVG}`);
  await page.screenshot({ path: join(root, `extension/public/icons/icon-${size}.png`), omitBackground: true });
}
await browser.close();
console.log('icons written');
