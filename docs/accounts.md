# Account providers

Token agents are one way in: each agent gets its own link from the side panel. **Account mode** is the other: a service people already sign in to (Migma is the built-in one) pairs a browser with a person in one click, then calls tools for that person from its own servers. Nothing is pasted anywhere.

## What a provider runs

1. **A relay** (`relay/`) with account mode on. Two hosts serve the same routes (`relay/src/core/app.ts`):
   - **Cloudflare Worker** (`relay/wrangler.toml`, `relay/src/worker/`). This is what Migma runs at `https://tabs.migma.ai`. Each browser is a Durable Object that holds its socket (hibernatable WebSocket, with an alarm for re-verify), and each person is another that lists their browsers. Set `PUBLIC_URL`, `INSTALL_URL` and `ACCOUNTS_VERIFY_URL` under `[vars]` and your domain's route, then:
     ```bash
     yarn --cwd relay wrangler secret put RELAY_SECRET            # 32+ random characters, keep it stable
     yarn --cwd relay wrangler secret put INTERNAL_SECRET
     yarn --cwd relay wrangler secret put ACCOUNTS_VERIFY_SECRET
     yarn --cwd relay deploy:worker
     ```
   - **Node** (`relay/src/node/`, or the `relay/Dockerfile` image) to self-host anywhere. Routing is in memory, so run one instance:
     ```bash
     PUBLIC_URL=https://tabs.example.com RELAY_SECRET=… \
     ACCOUNTS_VERIFY_URL=https://api.example.com/internal/tabpass/verify \
     ACCOUNTS_VERIFY_SECRET=… INTERNAL_SECRET=… \
     node dist/node/cli.js
     ```

   Account mode is on only when both `ACCOUNTS_VERIFY_URL` and `ACCOUNTS_VERIFY_SECRET` are set. `/internal` is on only when `INTERNAL_SECRET` is set.
2. **A verify endpoint** (`httpAccountVerifier` in `relay/src/core/accounts.ts`). The relay POSTs `{ connectionId, secret, browserId, browserName }` with `Authorization: Bearer ACCOUNTS_VERIFY_SECRET`, on every connect and then every 10 minutes while the browser stays connected.
   - Answer 200 `{ accountId, name? }` when the connection is valid.
   - Answer 404 or 410 when it is unknown or revoked. These are the only answers that make the browser forget it.
   - Anything else (401, 403, 5xx, no answer within 5 seconds) counts as "unavailable": the browser keeps its credential, a browser that was already verified stays connected, and the relay asks again in 60 seconds. So a wrong secret never wipes connections.

   `accountId` must be a **person**, never a team. Pin each connection to the first `browserId` that presents it, so a leaked secret cannot be replayed from another browser.
3. **A connect page** that creates a connection for the signed-in person and hands it to the extension through `externally_connectable`:
   ```js
   chrome.runtime.sendMessage(extensionId, {
     type: 'tabpass.connect',
     nonce, // from ?tabpass=, present when the person started in Tabpass
     connection: { connectionId, secret, relayUrl, account: { id, email, name } },
   });
   ```
   `relayUrl` is your relay's `wss://` address, e.g. `wss://tabs.example.com/extension`. The extension adds `?browser=<browserId>` itself.
4. **Calls** from your servers to the relay. Each needs `Authorization: Bearer INTERNAL_SECRET`; a wrong or missing secret gets 404.

   | Request | Reply |
   |---|---|
   | `GET /internal/accounts/:accountId/browsers` | `{ browsers: [{ browserId, name, connectedAt, lastActiveAt }] }` |
   | `POST /internal/accounts/:accountId/call` `{ tool, args, via? }` | MCP tool result `{ content, isError? }` |
   | `POST /internal/accounts/:accountId/connections/:connectionId/revoke` | `{ revoked: n }`: cuts the connection off now |

   To offer these tools in your own MCP server, the relay package exports `registerBrowserTools(server, accountTools(access), call)` and `ACCOUNT_INSTRUCTIONS`. Give it a `call` that posts to `/internal/accounts/:accountId/call`.

`RELAY_SECRET` also makes the relay an MCP OAuth 2.1 server (`relay/src/core/oauth.ts`), so any MCP client can use `<PUBLIC_URL>/mcp` directly and the person approves it in Tabpass. Those are token agents, separate from account mode. See [clients.md](clients.md).

## Adding a provider to the extension

- Add an entry to `PROVIDERS` in `extension/public/lib/providers.js`:
  - `id` and `name` (the name is what the person sees, e.g. "Allow Migma to use figma.com?"),
  - `origins` that may message the extension,
  - `connectUrl`,
  - `relayHosts` it may point the browser at (`wss://` only).
- List the same origins under `externally_connectable.matches` in `extension/public/manifest.json`. Chrome enforces that list; the extension checks again.

## Safety rules

- A page can connect a browser only with the nonce from the person's own click in Tabpass, or after the person confirms in Tabpass's window (where they also choose Read or Read and act).
- A provider can only use its own relay, over TLS.
- Account calls run as the provider's name ("Migma") with the access the person chose, and every new site still asks.
- The relay never treats a provider outage or a wrong relay secret as a revoke.

See [migma-integration.md](migma-integration.md) for the full Migma plan and edge cases.
