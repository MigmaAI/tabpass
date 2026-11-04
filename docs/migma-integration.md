# Connecting Migma to Tabpass

Migma uses the public Tabpass Web Protocol through `@migma/tabpass-connect`. The connection belongs to the signed-in person and gives Migma's design chat access to that person's browser tools during a live turn.

This flow is implemented in the local Migma frontend and backend workspaces. It is not proof of a production deployment or an enabled Tabpass account-provider integration.

## Person flow

1. The signed-in person clicks **Connect browser** in Migma.
2. Migma calls the SDK's `connect({ name: 'Migma', access })` directly from that click.
3. Tabpass opens its own approval window. The person chooses Read or Read and act.
4. The page immediately POSTs the returned token and fixed MCP endpoint to Migma's authenticated browser-connection API, then drops its page reference to the token.
5. The backend opens an MCP client, discovers the allowed browser tools, and checks that `list_tabs` is available before saving the connection.
6. Migma shows Connected only after that authenticated backend request succeeds.

The SDK does not store the token, call Migma's API, retry, navigate, or install Tabpass. Every participating website needs its own backend MCP client; adding the SDK does not automatically enable ChatGPT or another AI product.

## Local implementation

### Frontend

The Migma browser connection UI uses the package built from this repository's `connect/` directory. It reads the current authenticated status before connecting and includes the current `connectionId` as `expectedConnectionId` when replacing a connection. That compare-and-replace boundary prevents an older page from overwriting a newer connection.

The connect handler must:

- call `connect` directly from the person's click;
- POST only to Migma's authenticated same-site API;
- check `response.ok` before showing Connected;
- keep the token out of URLs, browser storage, logs, analytics, and durable client state;
- refresh status after timeout or abort instead of assuming the approval was cancelled.

An SDK timeout or abort stops only the page's wait. It cannot close Tabpass's approval window or cancel a grant the person approves afterward.

### Backend

`POST /api/browser-connection` accepts a strict payload:

```json
{
  "token": "tp_...",
  "mcpUrl": "https://tabs.migma.ai/mcp",
  "access": "read",
  "expectedConnectionId": null
}
```

The endpoint is authenticated and rate limited. It accepts only the fixed `https://tabs.migma.ai/mcp` endpoint, so a forged same-origin page message cannot turn the backend into an arbitrary URL fetch. It verifies the token by creating an MCP client and discovering browser tools before persisting anything.

The saved `browserConnections` record is personal and keyed by the authenticated Migma user. The credential is encrypted with Migma's existing secret-box helper. The record stores the verified tool snapshot, selected access, a connection version, and connection state. It is not attached to a brand or organization.

`GET /api/browser-connection` returns the person's current state. `DELETE /api/browser-connection/:connectionId` removes Migma's ability to use that credential with a compare-and-replace update. Removing the site's grant inside Tabpass remains a separate Web Protocol `disconnect` or extension action.

## Design-agent routing

Personal browser tools and brand-connected MCP tools have different namespaces and owners:

| Source | Namespace | Owner |
|---|---|---|
| Personal Tabpass browser | `browser__<tool>` | The authenticated person who started the live design turn |
| Brand MCP server | `mcp__<server>__<tool>` | The selected brand's configured MCP server |

The design route derives the browser actor from the authenticated request. It is passed explicitly through the single-email, series, gather, agent, capability-discovery, and execution paths. The browser connection manager reloads the current personal record before execution and requires the browser actor to match the executing user.

Browser tools are available only when external connectors are enabled and a live user-started path carries that explicit actor. Existing background jobs, campaign work, public API calls, Slack/Telegram entry points, and hosted Migma MCP calls do not gain browser access by default.

Read access exposes only `list_tabs`, `read_page`, `get_selection`, `screenshot`, `extract_design`, and `wait_for`. Control tools are included only when both the person approved control and the verified relay advertised them. Tool discovery presents personal browser tools separately from brand-connected apps, and progress labels use plain descriptions such as **Reading your browser** instead of exposing internal namespaces.

## Security boundaries

- The browser belongs to a person, never to a brand, organization, owner, or billing user.
- A page can receive same-origin `postMessage` events from any script running on that page. Backend authentication, the fixed MCP endpoint, strict token validation, MCP initialization, and tool discovery are the trust boundary.
- The backend never accepts `relay: true`, `connectorUrl`, or an arbitrary MCP endpoint from the public SDK flow.
- Read-only tokens cannot be widened by the request payload. Migma intersects the requested access with the tools the relay actually exposes.
- Connection replacement and deletion require the current connection version. Stale pages cannot silently restore or replace a newer record.
- Credentials stay server side after the handoff. Design tool results follow the design conversation's existing persistence and visibility rules. Page content added to a chat is visible to anyone with access, including public viewers when the chat is shared publicly.
- A `relay_unavailable` response is not Connected. Tabpass may still show a removable grant, so the person can remove it in the extension or the site can call `disconnect`.

## Account mode

Tabpass still contains a separate development prototype for binding an extension directly to a provider account through relay verification and internal account calls. That architecture is not required by Migma's SDK-based personal connection and must not be described as enabled in production. The store build keeps the account connection row hidden.

## Verification before release

Local implementation is not production proof. Before release, verify all of these independently:

- the package is published under the intended npm scope or installed from the reviewed build artifact;
- the frontend and backend revisions containing the flow are deployed;
- a real click opens Tabpass approval and a declined request stays disconnected;
- a successful token is rejected for any MCP endpoint other than `https://tabs.migma.ai/mcp`;
- Migma reports Connected only after backend MCP initialization succeeds;
- read access excludes control tools and control access still requires Tabpass's site approval at use time;
- one user cannot discover, execute, replace, or delete another user's browser connection;
- personal `browser__*` tools stay separate from brand `mcp__*` tools in discovery and UI labels;
- timeout, abort, relay failure, replacement races, and disconnect leave an honest refreshable state.
