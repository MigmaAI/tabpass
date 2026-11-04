import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';

/**
 * pdf.js as one classic script, because chrome.scripting cannot inject a module. tools.js injects it
 * into a tab only when an agent reads a PDF there. `public/` is copied as it is, so it is built here.
 */
async function buildPdfReader(outDir: string) {
  await build({
    configFile: false,
    logLevel: 'warn',
    // Only pdf.js's Node.js branch reads this, and that branch never runs in a browser.
    define: { 'import.meta.url': '""' },
    plugins: [
      {
        // core-js's last resort for finding the global object. Chrome always has globalThis, and
        // the store answers promise that the package never turns a string into code.
        name: 'tabpass-no-function-constructor',
        transform: (code) => code.replaceAll(/\bFunction\((['"])return this\1\)\(\)/g, 'undefined'),
      },
    ],
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome116',
      lib: {
        entry: resolve(import.meta.dirname, 'src/pdf-reader.js'),
        name: 'tabpassPdfReader',
        formats: ['iife'],
        fileName: () => 'content/pdf-reader.js',
      },
    },
  });
  const [notice, apache] = await Promise.all([
    readFile(resolve(import.meta.dirname, 'src/pdf-reader.NOTICE.txt'), 'utf8'),
    readFile(resolve(import.meta.dirname, 'node_modules/pdfjs-dist/LICENSE'), 'utf8'),
  ]);
  await writeFile(resolve(outDir, 'content/pdf-reader.LICENSE.txt'), notice + apache);
}

/**
 * `vite build --mode development` makes a test build: it uses a local relay
 * (ws://localhost:8787/extension), trusts a local provider page (TABPASS_DEV_PROVIDER, default
 * http://localhost:47821) for the one-click connect flow, and marks the name with "(dev)".
 * Production builds use the Migma-hosted relay unless TABPASS_RELAY names another one.
 */
function buildConfig(mode: string): Plugin {
  const dev = mode === 'development';
  const provider = process.env.TABPASS_DEV_PROVIDER ?? 'http://localhost:47821';
  const relay = process.env.TABPASS_RELAY ?? (dev ? 'ws://localhost:8787/extension' : 'wss://tabs.migma.ai/extension');
  return {
    name: 'tabpass-build-config',
    apply: 'build',
    async writeBundle(options) {
      if (!options.dir) return;
      await buildPdfReader(options.dir);
      await writeFile(
        resolve(options.dir, 'lib/build-config.js'),
        [
          '// Written by vite.config.ts.',
          `export const BUILD_MODE = ${JSON.stringify(dev ? 'development' : 'production')};`,
          `export const DEV_PROVIDER_ORIGIN = ${JSON.stringify(dev ? provider : '')};`,
          `export const DEFAULT_RELAY_URL = ${JSON.stringify(relay)};`,
          '',
        ].join('\n')
      );
      if (!dev) return;
      const manifestPath = resolve(options.dir, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.name = `${manifest.name} (dev)`;
      manifest.externally_connectable.matches.push('http://localhost/*', 'http://127.0.0.1/*');
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), buildConfig(mode)],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        prompt: resolve(import.meta.dirname, 'prompt.html'),
      },
      output: { chunkFileNames: 'assets/shared-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
}));
