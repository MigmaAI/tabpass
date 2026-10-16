import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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
