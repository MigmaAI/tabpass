import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * `vite build --mode development` makes a test build: it trusts a local provider page
 * (TABPASS_DEV_PROVIDER, default http://localhost:47821) for the one-click connect flow, and
 * marks the extension name with "(dev)". Production builds trust only the real providers.
 */
function devProvider(mode: string): Plugin {
  const origin = process.env.TABPASS_DEV_PROVIDER ?? 'http://localhost:47821';
  return {
    name: 'tabpass-dev-provider',
    apply: 'build',
    async writeBundle(options) {
      if (mode !== 'development' || !options.dir) return;
      const manifestPath = resolve(options.dir, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.name = `${manifest.name} (dev)`;
      manifest.externally_connectable.matches.push('http://localhost/*', 'http://127.0.0.1/*');
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await writeFile(
        resolve(options.dir, 'lib/build-config.js'),
        `export const BUILD_MODE = 'development';\nexport const DEV_PROVIDER_ORIGIN = ${JSON.stringify(origin)};\n`
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devProvider(mode)],
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
