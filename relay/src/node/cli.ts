#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

import { httpAccountVerifier } from '../core/accounts.js';

import { createRelayServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
// Local by default; set HOST=0.0.0.0 behind a TLS proxy when you deploy it.
const host = process.env.HOST ?? '127.0.0.1';
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

// OAuth (one URL for every MCP client) needs a stable secret, or sign-ins stop working on restart.
let secret = process.env.RELAY_SECRET;
if (!secret) {
  secret = randomBytes(32).toString('base64url');
  console.warn('[relay] RELAY_SECRET is not set: using a random one, so OAuth sign-ins end when the relay restarts.');
}

// Account mode (optional): a provider such as Migma verifies browser connections and calls tools
// for its users through /internal. See docs/accounts.md.
const accounts =
  process.env.ACCOUNTS_VERIFY_URL && process.env.ACCOUNTS_VERIFY_SECRET
    ? httpAccountVerifier({ url: process.env.ACCOUNTS_VERIFY_URL, secret: process.env.ACCOUNTS_VERIFY_SECRET })
    : undefined;

const relay = createRelayServer({
  publicUrl,
  secret,
  installUrl: process.env.INSTALL_URL || undefined,
  accounts,
  internalSecret: process.env.INTERNAL_SECRET || undefined,
  rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE ? Number(process.env.RATE_LIMIT_PER_MINUTE) : undefined,
  log: (message) => console.log(`[relay] ${message}`),
});

relay
  .listen(port, host)
  .then((boundPort) => {
    console.log(`[relay] listening on ${host}:${boundPort}`);
    console.log(`[relay] extension connects to ${publicUrl.replace(/^http/, 'ws')}/extension`);
    console.log(`[relay] AI tools connect to ${publicUrl}/mcp`);
    if (accounts) console.log('[relay] account mode on');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    relay.close();
    process.exit(0);
  });
}
