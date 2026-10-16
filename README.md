# Tabpass

**Give any AI agent a pass to your browser.** Tabpass lets Claude, ChatGPT, Cursor, Claude Code, Migma or any MCP client read and use your open Chrome tabs, from anywhere, and you approve each new site.

Open source (MIT), by the [Migma](https://migma.ai) team.

It follows the structure of OpenAI's ChatGPT Chrome extension: a side panel, per-site approval, a tab group per agent, and read vs act. The difference is that the browser is reached through a **remote MCP server**, so it is not locked to one assistant.

```
 AI agents ─── MCP over HTTPS ──┐         Account providers (Migma) ─── server-to-server ──┐
 (token link per agent)         ▼                                                          ▼
                      relay/   stateless Node server: /mcp, /extension, /internal
                                 │  WebSocket the browser opens outward (works behind NAT)
                                 ▼
                      extension/   Chrome MV3: side panel (shadcn/ui), site approval, 15 tools
```

## Two ways to connect

| | Token agents | Account (one click) |
|---|---|---|
| For | Any MCP client: Claude, ChatGPT, Cursor, Claude Code, your own | Services people sign in to; Migma is built in |
| Setup | **Connect an agent** in the side panel, then paste its link | **Connect to Migma** in the side panel. That's it. |
| Who it acts as | The agent's own name and access | The provider's name ("Migma") and the access the person chose |
| Revoke | Disconnect in the side panel | Disconnect in the side panel, or in the provider's settings |

Account mode is designed for teams: a browser binds to one **person**, never to an org, so teammates, admins and org-wide keys can never reach someone else's browser. See [docs/migma-integration.md](docs/migma-integration.md) for Migma's side and every edge case, and [docs/accounts.md](docs/accounts.md) to add another provider.

## Tools

| Tool | Level | What it does |
|---|---|---|
| `list_tabs` | read | Tabs in every window: id, title, URL, active, groups. Blocked sites are hidden. No prompt. |
| `read_page` | read | Clean text (headings, lists, links, tables). `interactive=true` adds buttons and fields with refs. Google Docs and Sheets are read through their export. |
| `get_selection` | read | The text the person highlighted. |
| `screenshot` | read | Visible part of a tab as JPEG or PNG. |
| `extract_design` | read | Palette with roles, fonts, type scale, button styles, radii, content width, logo, key images. |
| `wait_for` | read | Wait for a load, or for text to appear. |
| `open_tab`, `navigate`, `activate_tab`, `close_tabs`, `group_tabs` | act | Tab management. Opened tabs go into the agent's own group. |
| `click`, `type`, `press_key`, `scroll` | act | Act by ref, CSS selector, or visible text. |
| `list_browsers` | account | A person's connected browsers. Other tools take `browser` to pick one; the default is the one used last. |

Every page result starts with a line marking the content as untrusted, and the server instructions tell agents never to follow instructions found in pages.

## Repository

```
relay/        TypeScript relay: hub, MCP handler, account mode, internal API (vitest)
extension/    public/  service worker, tools, page agent, manifest (plain JS, copied as is)
              src/     side panel and prompt windows: React + Tailwind v4 + stock shadcn/ui
e2e/          real-Chromium end-to-end run with a fake Migma
docs/         accounts.md, migma-integration.md
```

The UI uses unmodified [shadcn/ui](https://ui.shadcn.com) components (`extension/src/components/ui`) on the zinc theme, the same neutral scale as Migma's product, in light and dark mode.

## Run it locally

```bash
yarn setup                                  # installs relay, extension and e2e
yarn --cwd relay build && yarn --cwd relay start      # relay on http://localhost:8787
yarn --cwd extension build                  # builds extension/dist
```

1. Open `chrome://extensions`, turn on Developer mode, **Load unpacked**, and pick `extension/dist`.
2. Click the toolbar icon. The side panel connects to `ws://localhost:8787/extension` (change it under **This browser**).
3. **Connect an agent**, name it, choose **Read** or **Read and act**, and copy its details into the agent:
   - Claude Code: `claude mcp add --transport http tabpass http://localhost:8787/mcp --header "Authorization: Bearer tp_…"`
   - Config-file clients (Cursor and others): the **MCP config** snippet.
   - URL-only connector screens (Claude.ai, ChatGPT): the **Connector URL**. These agents run in the cloud, so they need a relay with a public HTTPS address.

`yarn --cwd extension watch` rebuilds on change; `build:dev` makes a test build that also trusts a local fake Migma.

## Deploy the relay

```bash
docker build -t tabpass-relay relay
docker run -p 8787:8787 -e PUBLIC_URL=https://tabs.example.com tabpass-relay
```

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | |
| `PUBLIC_URL` | `http://localhost:$PORT` | The address agents use; sent to the extension so the panel shows correct links. |
| `RATE_LIMIT_PER_MINUTE` | `300` | MCP requests per token agent per minute. |
| `ACCOUNTS_VERIFY_URL`, `ACCOUNTS_VERIFY_SECRET` | off | Account mode: where the relay verifies browser connections. |
| `INTERNAL_SECRET` | off | Turns on `/internal` for the account provider's servers. |

Put it behind TLS with WebSocket upgrades on `/extension`. Routing is in memory, so run **one instance** (shard by browser id before scaling out). `GET /health` reports browsers, accounts and pending calls. The relay is also a library: `createRelay()` returns `handleHttp` and `handleUpgrade`, and `registerBrowserTools()` adds the tools to any MCP server.

## Security model

- **No database on the relay.** The extension makes a random `browserKey` on install; its browser id is a hash of that key, so only that browser can register under it. A token agent's link is `tp_<browserId>.<secret>`, and the relay only ever sees `sha256(secret)`.
- **One-click connect cannot be forced.** A provider's page can connect a browser only with the nonce from the person's own click in Tabpass, or after they confirm in Tabpass's own window. A provider can only point the browser at its own `wss://` relay.
- **Per-site approval, per agent.** Listing tab titles needs no prompt; reading or acting on a site does. Blocked sites are hidden from `list_tabs`. Read-only agents do not even see the act tools, and a switch in the header pauses every agent.
- **Revoking is instant**: a disconnected agent's next request gets 401, and a revoked account is cut off immediately (or within 10 minutes through re-verify).
- **Outages never disconnect people**: a provider outage or a wrong relay secret counts as "unavailable", never as "revoked".
- **Visible**: while an agent acts, a blue frame and a "Claude is using this tab" label show on the page, and the activity list records every call, including failures.
- **Isolated**: the page agent runs in the extension's isolated world; pages cannot see or call it, and element refs are never written into the DOM.
- **Treat a Connector URL like a password.** The relay sees page content in transit, so self-host it or use your provider's.

## Known limits

- Clicks and keys are DOM events, not real input, so pages get no user activation. `window.open` popups, some clipboard and file-picker flows, and sites that check `event.isTrusted` will not respond. An optional Chrome debugger mode would fix this, at the cost of Chrome's "debugging this browser" bar.
- Top frame only: no iframes or closed shadow roots. Canvas apps have no DOM text. The Google Docs and Sheets readers use their export endpoints and **are not yet tested against real Google accounts**.
- Local `.docx` files and PDFs in Chrome's viewer are not supported yet.

## Tests

```bash
yarn test        # 29 relay tests + typechecks
yarn test:e2e    # 23 end-to-end steps in real Chromium (needs xvfb)
```

The end-to-end run loads the built extension, drives the side panel like a person would, connects MCP agents, and runs the whole Migma flow against a fake Migma:

- one-click connect (the tab closes itself),
- account calls and team isolation,
- site-initiated connect with confirmation and account replacement,
- cancel, nonce replay and foreign-relay rejection,
- revocation with a notice in the panel, and disconnecting from either side.

`SCREENSHOT_DIR=/some/dir` saves screenshots of the panel and both prompt windows.
