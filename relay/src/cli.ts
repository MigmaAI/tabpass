#!/usr/bin/env node
import { createRelayServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
// Local by default; set HOST=0.0.0.0 behind a TLS proxy when you deploy it.
const host = process.env.HOST ?? '127.0.0.1';
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

const relay = createRelayServer({
  publicUrl,
  rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE ? Number(process.env.RATE_LIMIT_PER_MINUTE) : undefined,
  log: (message) => console.log(`[relay] ${message}`),
});

relay
  .listen(port, host)
  .then((boundPort) => {
    console.log(`[relay] listening on ${host}:${boundPort}`);
    console.log(`[relay] extension connects to ${publicUrl.replace(/^http/, 'ws')}/extension`);
    console.log(`[relay] agents connect to ${publicUrl}/mcp`);
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
