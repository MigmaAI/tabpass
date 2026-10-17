# Connecting Migma to Tabpass

Migma's **Connect browser** action connects the signed-in person's Chrome to their live design chats. It uses the public [Tabpass Web Protocol](web-protocol.md) through [`@migma/tabpass-connect`](../connect/README.md). The connection belongs to the person, not a brand or organization.

## Connect and disconnect

1. Install and enable Tabpass in the Chrome profile where you use Migma, with the default `tabs.migma.ai` relay.
2. In a Migma design chat, open **Tools and connectors → Connect browser**, then click **Connect browser** in the dialog.
3. Approve in Tabpass's own window. **Read** is the default; the person can choose **Read and act**.
4. Migma verifies the returned credential against the relay before showing Connected. Keep **Use connectors** enabled when asking Migma to use the browser.

Tabpass asks before reading or acting on a new site. Listing tab titles and URLs needs no site prompt. Browser access is personal, but page content added to a chat follows that chat's visibility, including public viewers when shared publicly.

The same dialog offers **Reconnect** and **Disconnect**. Disconnect removes Migma's saved credential so further browser calls are refused. It does not erase content already included in chats or remove the extension's grant. The person can remove that grant separately in Tabpass's side panel.

## Architecture

```text
Migma page ── Web Protocol approval ─► Tabpass extension
    │ approved MCP credential
    ▼
Authenticated Migma API ── MCP over HTTPS ─► tabs.migma.ai/mcp
                                               │ WebSocket
                                               ▼
                                        Tabpass extension
```

The page hands the approved token to Migma's authenticated backend. The backend initializes an MCP client and discovers the browser tools before saving the encrypted credential. Subsequent browser calls use the relay's standard MCP endpoint, not its internal provider-account API. This flow needs no extension ID, account-provider verification endpoint, or additional relay secrets.

The SDK handles the page-to-extension exchange only. It does not store credentials or call Migma's API. Other websites can use the same SDK, but each needs its own authenticated backend and MCP client. Installing the SDK does not automatically connect an unrelated AI product.

## Credential handoff and retries

Migma reads the signed-in person's saved connection state before connecting. After a click, the page probes Tabpass with `hello`, then calls `connect({ name: 'Migma', access: 'read' })` while the click's user activation is still valid. The returned access reflects the person's choice in Tabpass.

The page immediately POSTs the grant to Migma's authenticated API and shows Connected only after the backend succeeds. On a save failure, it retains the grant only in page memory for **Retry save**, avoiding a second approval. It clears that reference after a successful save, a stale-version conflict, dialog close, or account change. The token is never put in URLs, browser storage, logs, analytics, or durable client state.

An SDK timeout or abort stops the page from waiting; it cannot close Tabpass's approval window or revoke a grant approved afterward. Reopen the dialog to refresh Migma's saved status, and check Tabpass's side panel for an unused grant. A `relay_unavailable` result is not Connected, even if Tabpass saved a removable grant.

## Migma's authenticated API

These dashboard routes use the signed-in user's identity, not an owner, billing user, or page-supplied user ID.

`POST /api/browser-connection` accepts a strict payload:

```json
{
  "token": "tp_...",
  "mcpUrl": "https://tabs.migma.ai/mcp",
  "access": "read",
  "expectedConnectionId": null
}
```

The endpoint is rate limited and accepts only the fixed `https://tabs.migma.ai/mcp` address. It initializes MCP, discovers tools, and requires `list_tabs` before saving. A page cannot widen a read-only token: Migma intersects requested access with the tools the relay advertises.

`GET /api/browser-connection` returns the saved `connected`, `connectionId`, and `access` state, without the credential. This is saved connection status, not a live browser-online probe. The personal `browserConnections` record is keyed by the authenticated user and stores an encrypted token, verified tool snapshot, and connection revision. There is one saved connection per user; reconnecting replaces it.

Replacing a connection requires the current `connectionId` as `expectedConnectionId`. `DELETE /api/browser-connection/:connectionId` removes the matching credential and keeps a credential-free revision so an older pending save cannot restore it. Stale saves and deletions return a conflict; after a stale save, the page refreshes status. Migma does not call the SDK's origin-wide `disconnect()` during this deletion, because it could revoke a newer grant created by another tab.

## Design-agent scope

| Source | Namespace | Owner |
|---|---|---|
| Personal Tabpass browser | `browser__<tool>` | The authenticated person who started the live design turn |
| Brand MCP connector | `mcp__<server>__<tool>` | The selected brand's configured connector |

The authenticated design route explicitly forwards the browser actor through the single-email, series, research, and agent paths. Tools are offered only when external connectors are enabled. Execution checks brand access, requires the browser actor to match the executing user, and reloads the personal connection before calling the relay. Cached transports do not bypass connection or permission changes.

Read access exposes `list_tabs`, `read_page`, `get_selection`, `screenshot`, `extract_design`, and `wait_for`. Research uses only those read tools, even for a connection with control access. Control tools require both the person's approval in Tabpass and the relay's control tool advertisement; Migma asks for approval before executing them. Tabpass's site permissions still apply.

Background jobs, campaign work, public API requests, Slack/Telegram entry points, and hosted Migma MCP requests do not inherit this personal browser access. Brand membership and admin roles do not grant another person's browser connection. Tool results follow the conversation's existing persistence and visibility rules.

## Trust boundaries

Any script on the page can send same-origin `postMessage` responses. Backend authentication, strict token validation, the fixed MCP endpoint, and successful MCP initialization and discovery establish the connection. Migma does not accept an arbitrary endpoint, `relay: true`, or `connectorUrl` in this handoff.

The relay forwards page content; Migma may retain it as part of a chat. Disconnecting prevents further use of the saved credential and does not delete that content. Tool timeouts can leave an unknown outcome, so Migma does not automatically replay a failed browser call.

## Separate provider-account prototype

Tabpass also contains a development-only [provider-account architecture](accounts.md), with direct extension account binding, internal relay calls, verification secrets, and multi-browser routing. It is separate from Migma's personal SDK connection. The store build keeps that account Connect row hidden, and Migma's personal flow does not use `/connect/browser`, `chrome.runtime.sendMessage(extensionId, ...)`, or `/internal/accounts/...`.
