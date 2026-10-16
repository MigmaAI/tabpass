// Cloudflare Worker entry: the same HTTP app as the Node relay, with browsers held by Durable
// Objects. Deploy with `yarn deploy:worker` (wrangler.toml).

import { createRelayApp, type RelayApp } from '../core/app.js';
import { BROWSER_ID_PATTERN } from '../core/tokens.js';

import { DurableDirectory } from './durable-directory.js';
import type { Env } from './env.js';

export { AccountObject } from './account-object.js';
export { BrowserObject } from './browser-object.js';

let cached: { env: Env; app: RelayApp } | null = null;

function appFor(env: Env): RelayApp {
  if (cached?.env !== env) {
    cached = {
      env,
      app: createRelayApp({
        publicUrl: env.PUBLIC_URL,
        directory: new DurableDirectory(env),
        secret: env.RELAY_SECRET,
        installUrl: env.INSTALL_URL,
        internalSecret: env.INTERNAL_SECRET,
      }),
    };
  }
  return cached.app;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/extension') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const browserId = url.searchParams.get('browser') ?? '';
      if (!BROWSER_ID_PATTERN.test(browserId)) return new Response('Update Tabpass: this relay needs ?browser=<id>', { status: 400 });
      return env.BROWSERS.get(env.BROWSERS.idFromName(browserId)).fetch(request);
    }
    return appFor(env).fetch(request);
  },
} satisfies ExportedHandler<Env>;
