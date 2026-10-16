# Account providers

Token agents are one way in: each agent gets its own link from the side panel. **Account mode** is the other: a service people already sign in to (Migma is the built-in one) pairs a browser with a person in one click, then calls tools for that person from its own servers. Nothing is pasted anywhere.

## What a provider runs

1. **A relay** (`relay/`) with account mode on:
   ```bash
   PUBLIC_URL=https://tabs.example.com \
   ACCOUNTS_VERIFY_URL=https://api.example.com/internal/tabpass/verify \
   ACCOUNTS_VERIFY_SECRET=… INTERNAL_SECRET=… \
   node dist/cli.js
   ```
2. **A verify endpoint**: the relay POSTs `{ connectionId, secret, browserId, browserName }` with `Authorization: Bearer ACCOUNTS_VERIFY_SECRET`.
   - Answer 200 `{ accountId, name? }` when the connection is valid.
   - Answer 404 when it is unknown or revoked.
   - Any other status counts as "unavailable": the browser keeps its credential and retries.

   `accountId` must be a **person**, never a team.
3. **A connect page** that creates a connection for the signed-in person and hands it to the extension:
   ```js
   chrome.runtime.sendMessage(extensionId, {
     type: 'tabpass.connect',
     nonce, // from ?tabpass=, present when the person started in Tabpass
     connection: { connectionId, secret, relayUrl, account: { id, email, name } },
   });
   ```
4. **Calls**: `POST /internal/accounts/:accountId/call { tool, args, via }` with `Authorization: Bearer INTERNAL_SECRET`. To cut a connection off immediately: `POST /internal/connections/:connectionId/revoke`.

## Adding a provider to the extension

- Add an entry to `PROVIDERS` in `extension/public/lib/providers.js`:
  - `origins` that may message the extension,
  - `connectUrl`,
  - `relayHosts` it may point the browser at (`wss://` only).
- List the same origins under `externally_connectable.matches` in `extension/public/manifest.json`. Chrome enforces that list; the extension checks again.

## Safety rules the extension enforces

- A page can connect a browser only with the nonce from the person's own click in Tabpass, or after the person confirms in Tabpass's window (where they also choose Read or Read and act).
- A provider can only use its own relay, over TLS.
- Account calls run as the provider's name ("Migma") with the access the person chose, and every new site still asks.
- The relay never treats a provider outage or a wrong relay secret as a revoke.

See [migma-integration.md](migma-integration.md) for the full Migma plan and edge cases.
