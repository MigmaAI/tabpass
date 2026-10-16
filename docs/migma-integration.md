# Connecting Migma to Tabpass

How Migma pairs a person's Chrome with their Migma account in one click, so Migma's AI (and any agent using Migma's MCP connector) can read their tabs. The Tabpass side (extension and relay) is built and tested in this repo. The relay runs as a Cloudflare Worker at `https://tabs.migma.ai`. The Migma side (migma-backend, migma frontend) is specified here and not built yet.

## What the person does

| Step | Person | System |
|---|---|---|
| 1 | Installs Tabpass from the Chrome Web Store | |
| 2 | Clicks **Connect to Migma** in the side panel | Tabpass opens `migma.ai/connect/browser?tabpass=<nonce>&ext=<id>&v=<version>` |
| 3 | (Only if signed out) signs in | Migma creates a connection and hands it to Tabpass with the nonce |
| 4 | Nothing | The Migma tab closes; the panel shows "Connected as alice@…" |

One click when already signed in. From inside Migma (a "Use my browser" button in chat or brand setup), it's one click on the button plus **Connect** in Tabpass's own window, where the person also picks Read or Read and act.

New connections start at **Read**. Every site still needs its own approval, and the prompt says "Allow Migma to use figma.com?".

## Facts about Migma this design relies on

From migma-backend and the migma frontend as of this writing:

- **Every credential is a person.** `PlatformApiKey.userId` is required, OAuth access tokens are freshly minted `sk_live_` keys for `grant.userId` with no org, and the dashboard JWT carries `userId`. Orgs only appear when a request touches a project (`AccessService.resolve`). So a browser binds to a `userId`, never to an org.
- **The backend has no WebSocket server** (`app.listen` has no upgrade handler; `ws` is a dependency but unused), runs several instances, and already uses Redis pub/sub (node-redis v4) for MCP approvals.
- **`/mcp` is stateless** (`sessionIdGenerator: undefined`). It is served at `migma.ai/mcp` by a Cloudflare worker that streams to `api.migma.ai/mcp`, and builds a fresh `McpServer` per request.
- **The frontend calls `https://api.migma.ai`** with a Bearer token and sends the selected org as `X-Migma-Organization-Id`.
- **Settings** have a Developers group (`integrations`, `api-keys`, `webhooks`) that `WORKSPACE_ACCOUNT_TABS` limits to owner/admin.

## Architecture

```
 Migma AI / MCP clients ──► api.migma.ai (/mcp, design chat)
                               │  POST /internal/accounts/:userId/call   (INTERNAL_SECRET)
                               ▼
                         Tabpass relay  (Cloudflare Worker, tabs.migma.ai)
                               │  ▲ POST /internal/tabpass/verify        (ACCOUNTS_VERIFY_SECRET)
                               │  └──────────────────────────────────── api.migma.ai
                               ▼  wss://tabs.migma.ai/extension?browser=<browserId>
                         Tabpass extension (person's Chrome)
```

**Run the relay as the Cloudflare Worker** in this repo (`relay/wrangler.toml`, entry `relay/src/worker/index.ts`), not inside migma-backend:

- The backend would need an upgrade handler plus cross-instance routing (Redis pub/sub keyed by browser) for sockets to land on the right instance.
- On the Worker, each browser is its own Durable Object (`BrowserObject`, named by browser id). It holds the extension's socket with the WebSocket hibernation API, so an idle browser costs nothing and Cloudflare answers pings without waking it.
- Each person is another Durable Object (`AccountObject`, named by `userId`) that lists their connected browsers. A call for a person reads that list and goes to one of their browsers. No single process holds the sockets, so there is nothing to shard.
- A Durable Object alarm re-verifies each connected browser every 10 minutes.
- Migma stays the source of truth for connections: the relay asks it to verify each one.

The Node host (`relay/src/node/`, `relay/Dockerfile`) still exists for self-hosting. It keeps routing in memory, so it runs as one instance.

Relay settings (`relay/src/worker/env.ts`):

| Name | Kind | Value |
|---|---|---|
| `PUBLIC_URL` | var in `wrangler.toml` | `https://tabs.migma.ai` |
| `INSTALL_URL` | var in `wrangler.toml` | Where the OAuth sign-in page sends people without Tabpass. The GitHub install section today; the Web Store page once published. |
| `ACCOUNTS_VERIFY_URL` | var in `wrangler.toml` (commented out today) | `https://api.migma.ai/internal/tabpass/verify` |
| `RELAY_SECRET` | secret | 32+ random characters, kept stable. Turns on OAuth. |
| `ACCOUNTS_VERIFY_SECRET` | secret | shared secret; the relay sends it, the backend checks it |
| `INTERNAL_SECRET` | secret | shared secret; the backend sends it, the relay checks it |

Account mode is on only when both `ACCOUNTS_VERIFY_URL` and `ACCOUNTS_VERIFY_SECRET` are set. `/internal` is on only when `INTERNAL_SECRET` is set.

Deploy (first uncomment the `tabs.migma.ai` custom-domain route in `wrangler.toml`):

```bash
yarn --cwd relay wrangler secret put RELAY_SECRET
yarn --cwd relay wrangler secret put INTERNAL_SECRET
yarn --cwd relay wrangler secret put ACCOUNTS_VERIFY_SECRET
yarn --cwd relay deploy:worker
```

The extension already only accepts Migma relays on `wss://*.migma.ai` (`extension/public/lib/providers.js`). Its default relay is `wss://tabs.migma.ai/extension`, so when Migma hands over that same relay, the Migma connection and the person's other AI tools share one socket.

**Other MCP clients.** The same Worker is an MCP OAuth 2.1 server (`relay/src/core/oauth.ts`): dynamic client registration, Client ID Metadata Documents (`client_id_metadata_document_supported: true`), PKCE with S256, and `iss` on the redirect. Any MCP client can add `https://tabs.migma.ai/mcp` and sign in; the person approves it in Tabpass's own window (see [clients.md](clients.md)). Those clients are ordinary Tabpass agents, separate from the Migma connection. Migma's own agents do not use this path: they go through Migma's `/mcp` and the internal API.

## Contracts (built and tested)

**Website → extension** (`chrome.runtime.sendMessage(extensionId, message)`; only `https://migma.ai/*` and `https://*.migma.ai/*` can send):

| Message | Reply |
|---|---|
| `{ type: 'tabpass.hello' }` | `{ ok, extension: 'tabpass', version, browserName, connected, account: { id, email, name } \| null, access }` |
| `{ type: 'tabpass.connect', nonce?, connection: { connectionId, secret, relayUrl, account: { id, email?, name? } } }` | `{ ok, connected: true, access, browserName }` or `{ ok, connected: false, reason: 'declined' \| 'timeout' }` or `{ ok: false, error }` |
| `{ type: 'tabpass.disconnect', connectionId? }` | `{ ok, disconnected }` |

With a valid `nonce` (from the extension's own **Connect to Migma**, single use, 10 minutes), connect is immediate and the extension closes the tab it opened. Without one, Tabpass asks in its own window first. `connectionId` is 8 to 128 characters from `[A-Za-z0-9_-]`; `secret` is 32 to 256 characters from the same set (use 32 random bytes, base64url). `relayUrl` is `wss://tabs.migma.ai/extension`; the extension adds `?browser=<browserId>` itself.

**Relay → backend** (`httpAccountVerifier` in `relay/src/core/accounts.ts`): `POST ACCOUNTS_VERIFY_URL`, `Authorization: Bearer ACCOUNTS_VERIFY_SECRET`, body `{ connectionId, secret, browserId, browserName }`. The relay checks `browserId` against the browser's own key before it asks.

- 200 `{ accountId: userId, name }` when the connection is valid.
- 404 or 410 when it is unknown or revoked: the browser is told to forget it. These are the only answers that revoke.
- Anything else means unavailable: 401, 403, 5xx, no answer within 5 seconds, or a 200 without `accountId`. The browser keeps its credential, a browser that was already verified stays connected, and the relay asks again in 60 seconds. So a wrong secret or a Migma outage never disconnects anyone.

The relay asks on every connect, then every 10 minutes while the browser stays connected.

**Backend → relay** (`handleInternal` in `relay/src/core/app.ts`). Every request needs `Authorization: Bearer INTERNAL_SECRET`. A wrong or missing secret gets 404, as if the route did not exist.

| Request | Reply |
|---|---|
| `GET /internal/accounts/:userId/browsers` | `{ browsers: [{ browserId, name, connectedAt, lastActiveAt }] }`: the person's connected, verified browsers (times in ms). |
| `POST /internal/accounts/:userId/call` `{ tool, args, via? }` | MCP tool result `{ content, isError? }`. `args.browser` picks a browser by name or id. `via` (e.g. "Claude") shows in the person's activity. An unknown tool or bad args gets 400 `{ error }`. |
| `POST /internal/accounts/:userId/connections/:connectionId/revoke` | `{ revoked: n }`: how many live browsers it reached. They forget the connection at once. A browser that is offline is refused by verify when it next connects. |

The MCP tool list and schemas come from the relay package (`relay/src/index.ts`): `accountTools(access)` (the browser tools plus `list_browsers`, each with an optional `browser` argument), `registerBrowserTools(server, tools, call)` (`relay/src/core/mcp.ts`) and `ACCOUNT_INSTRUCTIONS`.

## Backend work (migma-backend)

1. **Collection `browserConnections`**: `{ connectionId, userId, secretHash, browserId?, browserName, createdAt, lastSeenAt, revokedAt? }`.
   - Indexes in `src/config/database-indexes.ts`: unique `{ connectionId: 1 }`, `{ userId: 1, revokedAt: 1 }`, and a TTL on `expiresAt` (pushed to 90 days on each verify, so unused browsers clean themselves up).
   - It is a new, empty collection, so **no backfill**. Build the indexes with `--only browserConnections` before release.
2. **`POST /api/browser-connections`** (dashboard auth). Creates a connection for `req.user`: 32 random bytes as `secret` (store only `sha256`), returns `{ connectionId, secret, relayUrl, account: { id: userId, email, name } }`. Use its own rate-limit namespace (`browser-connect`) and cap active connections per person (e.g. 10 → 409).
3. **`GET /api/browser-connections`** and **`DELETE /api/browser-connections/:connectionId`**.
   - The list merges `lastSeenAt` with live status from the relay's `GET /internal/accounts/:userId/browsers`.
   - Delete marks `revokedAt` first (durable), then calls `POST /internal/accounts/:userId/connections/:connectionId/revoke`. If that call fails, the next verify (on connect, or the 10-minute re-verify) still lands it.
4. **`POST /internal/tabpass/verify`** (relay only, secret checked timing-safe). Looks up by `connectionId`, compares `sha256(secret)` timing-safe, then checks it is not revoked and the user exists and is enabled.
   - Pins `browserId` on first use and returns 404 on a mismatch, so a leaked secret cannot be replayed from another browser.
   - Every "no" (unknown, revoked, disabled user, other browser) must be 404 or 410. A 401 or 403 reads as "unavailable" and the browser stays connected.
   - Updates `lastSeenAt`, `browserName` and `expiresAt`.
5. **MCP (`src/routes/mcp.ts`)**. In the per-request server, add `registerBrowserTools(server, accountTools(level), (tool, args) => relayCall(apiKey.userId, tool, args, clientName))`, but only when the key has the new permission. `relayCall` posts `{ tool, args, via: clientName }` to `/internal/accounts/:userId/call`.
   - Add `browser:read` or `browser:control` to `ApiPermission`. Existing keys have neither, so nobody gets browser access by surprise, and OAuth consent asks for it.
6. **Design agent (`/api/design/chat`)**. Browser tools are offered only in a live turn the person started, and only for their own browser.
   - Never in BullMQ workers, scheduled tasks or campaign sends: nobody is there to answer a site prompt.
   - Per this repo's backend rules, update `DESIGN_FLOW.md`, `docs/design-routing-cases.md` and the design-process test in the same change.
7. **Revoke everything** on account deletion, "sign out everywhere" and password change: mark each connection revoked, then call the relay's revoke for each.

## Frontend work (migma)

1. **`/connect/browser` page**.
   - Read `tabpass` (nonce) and `ext` (extension id). Require sign-in, and keep both through the login redirect.
   - `POST /api/browser-connections`, then `chrome.runtime.sendMessage(ext, { type: 'tabpass.connect', nonce, connection })`.
   - Show "Connected" (Tabpass closes the tab).
   - If the extension does not answer, show the Web Store link. If the reply is `connected: false`, say it was not connected.
2. **Settings → Browsers**: name, last seen, online, **Disconnect**. Browsers are personal, so this belongs with personal settings, visible to every member. It must not sit behind `WORKSPACE_ACCOUNT_TABS`'s owner/admin gate.
3. **"Use my browser" in the app**.
   - `tabpass.hello` to the store extension id tells installed, connected, and as whom.
   - Not installed: link to the store. Installed but not connected, or connected as someone else: send `tabpass.connect` without a nonce, and Tabpass confirms in its own window.
4. Follow `migma-frontend-designer` and the copywriting rules for both screens.

## Edge cases

Tested ones run in `relay/test/accounts.test.ts` (Node host), `relay/test/worker.test.ts` (Worker) or `e2e/run.mjs`.

### Teams

| Case | Behavior | Status |
|---|---|---|
| Teammates in one org or brand | A browser belongs to one person. A call for Bob never reaches Alice's browser, whatever org or project it came from. | Tested |
| Org owner or admin | No access to members' browsers, and no admin override. | Policy |
| Shared or automation API keys | Keys are personal in Migma, so a CI key reaches its creator's browser only if the key has `browser:*`. Off by default. | Backend step 5 |
| Shared brand chat | Uses the browser of the person who sent the message, never the project owner's. | Backend step 6 |
| Member removed from an org | Their browser connection is personal and stays. Migma's per-request `requireAccess` still decides which projects the agent may act in. | Existing |
| Org policy (enterprise) | Optional org setting "members may use connected browsers". When off, the backend does not offer browser tools in that org's context. Personal connections are not revoked. | Backend step 5 |

### Identity

| Case | Behavior | Status |
|---|---|---|
| Two Migma accounts, one Chrome profile | One Migma account per profile. A site-initiated connect says "This replaces alice@…"; the old account loses access at once. Use two Chrome profiles to keep both. | Tested |
| Connect page signed in as someone else | The page shows who will be connected. The site-initiated path shows the email in Tabpass's window. | Tested |
| Sign out of Migma | The browser stays connected, like a device. "Sign out everywhere" revokes it. | Backend step 7 |
| Account deleted | Verify returns 404, Tabpass forgets the connection and says "Migma disconnected this browser". | Tested |

### Browsers

| Case | Behavior | Status |
|---|---|---|
| Several browsers or profiles | Each one is its own connection with its own name. Calls go to the most recently focused browser; agents can `list_browsers` and pass `browser`. | Tested |
| Browser closed or asleep | Tools answer "No browser is connected for this person right now"; Migma can say so and ask. | Tested |
| Extension reinstalled | New browser key, so a new browser id. The old connection never verifies again and its TTL cleans it up. | By design |
| Stolen connection secret | Pinned to the first browser id; only the hash is stored; revocable. | Backend step 4 |

### Security

| Case | Behavior | Status |
|---|---|---|
| A page tries to connect silently (phishing, XSS) | Impossible without the extension's own nonce or the person confirming in Tabpass's window. | Tested |
| Reused or expired nonce | Single use, 10 minutes. A replay falls back to the confirmation window. | Tested |
| A page points the browser at another relay | Rejected: Migma connections must use `wss://*.migma.ai`. | Tested |
| Relay misconfigured (wrong secret) | A wrong `ACCOUNTS_VERIFY_SECRET` gets 401/403 from verify, which counts as "unavailable", not "revoked", so nobody is disconnected. A wrong `INTERNAL_SECRET` gets 404 from the relay. | Tested |
| Wrong `ACCOUNTS_VERIFY_URL` | A path that answers 404 reads as revoked, and browsers forget their connection. Check the URL with one test connection before launch. | By design |
| Migma API down | Credentials are kept, already-verified browsers keep working, and the relay asks again every 60s. | Tested |
| Revocation speed | Immediate through the internal revoke; at most 10 minutes through re-verify. | Tested |
| Prompt injection in page content | Every page result starts with an untrusted-content line. Migma's agent prompts must treat page text as data. | Partly built |
| Background jobs | No browser access. | Backend step 6 |
| Data retention | Store page content only when it becomes part of a chat, brief or saved reference. | Policy |

### Operations

| Case | Behavior | Status |
|---|---|---|
| Relay restart or deploy | Extensions reconnect with backoff; in-flight calls fail. OAuth sign-ins survive while `RELAY_SECRET` stays the same. | Tested |
| Protocol change | The relay refuses old extensions with an "update" message, shown in the panel. | Built |
| Scale | Each browser and each person is its own Durable Object, so no single process holds every socket. The Node host keeps routing in memory and runs as one instance. | Built |

## Rollout

1. Deploy the relay Worker at `tabs.migma.ai` with `ACCOUNTS_VERIFY_URL` and its three secrets, plus the backend verify endpoint and `browserConnections`.
2. Ship `/connect/browser` and Settings → Browsers. Publish Tabpass to the Web Store and pin its id.
3. Turn on browser tools in `/mcp` for keys with `browser:*`.
4. Let the design agent use `extract_design`, `read_page` and `screenshot`, turning brand sites, briefs and inspiration into brand guidelines, briefs and saved references.

## Decisions for Migma

- **Plan gating**: all plans, or paid plans only.
- **Default access for Migma**: Read (recommended; already the default in the extension).
