# Migma Tabs

Let any AI agent read and use your open Chrome tabs over MCP, from anywhere. You approve each new site.

Built on the same structure as OpenAI's ChatGPT Chrome extension (side panel, per-site approval, agent tab groups, read vs act), but the browser is reached through a **remote MCP server** instead of being locked to one assistant. Claude, ChatGPT connectors, Cursor, Claude Code and, later, Migma's own design agent can all connect.

```
 AI agent (Claude, ChatGPT, Cursor, Claude Code, Migma)
    │  MCP over HTTPS: POST /mcp  (Bearer token, or /mcp/<token> for URL-only connector UIs)
    ▼
 relay/            stateless Node server, no database
    │  WebSocket the browser opens outward (works behind NAT and firewalls)
    ▼
 extension/        Chrome MV3 extension
    ├─ background.js           relay connection, tool dispatch, side-panel API
    ├─ lib/permissions.js      per-site, per-agent approval (prompt window)
    ├─ lib/tools.js            the 15 tools, on chrome.tabs / tabGroups / scripting
    └─ content/page-agent.js   injected into the tab's isolated world: text, refs, click, type, design
```

## Compared with ChatGPT's extension

| | ChatGPT for Chrome | Migma Tabs |
|---|---|---|
| Who can use it | ChatGPT / Codex only | Any MCP client |
| Transport | ChatGPT sidebar, native messaging to the Codex app | Outbound WebSocket to a relay; agents use remote MCP |
| Side panel | Chat and history | Agents, activity, sites, relay |
| Site approval | Allow once / this site / all sites / decline, plus allow and block lists | Allow for 10 min / always / every site / decline / block, per agent |
| Agent tabs | Own tab group per task | Own tab group per agent |
| Read tabs, highlighted text, screenshots | Yes | Yes, plus `extract_design` for colors, fonts, buttons and logo |
| Act (click, type, forms) | Work mode | Agents with "Read and act" |
| Input method | Chrome debugger (CDP) | DOM events, no debugger permission (see limits) |

The ChatGPT package itself could not be downloaded from this build environment (the Chrome Web Store is blocked here), so the comparison comes from OpenAI's docs and press coverage, not from its source.

## Tools

| Tool | Level | What it does |
|---|---|---|
| `list_tabs` | read | Tabs in every window: id, title, URL, active, groups. Blocked sites are hidden. No prompt. |
| `read_page` | read | Clean text (headings, lists, links, tables). `interactive=true` adds buttons and fields with refs. Google Docs and Sheets are read through their export. |
| `get_selection` | read | The text the user highlighted. |
| `screenshot` | read | Visible part of a tab as JPEG or PNG. |
| `extract_design` | read | Palette with roles, fonts, type scale, button styles, radii, content width, logo, key images. |
| `wait_for` | read | Wait for a load, or for text to appear. |
| `open_tab`, `navigate`, `activate_tab`, `close_tabs`, `group_tabs` | act | Tab management. Opened tabs go into the agent's own group. |
| `click`, `type`, `press_key`, `scroll` | act | Act on the page by ref, CSS selector, or visible text. |

Every page result starts with a line marking the content as untrusted, and the server instructions tell agents never to follow instructions found in pages.

## Run it locally

```bash
cd relay && yarn && yarn build && yarn start      # relay on http://localhost:8787
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, pick `extension/`.
2. Click the toolbar icon. The side panel opens and connects to `ws://localhost:8787/extension` (change it under **Relay**).
3. **Connect an agent**: name it, choose **Read** or **Read and act**, then copy its details.
4. Give them to the agent:
   - Claude Code: `claude mcp add --transport http migma-tabs http://localhost:8787/mcp --header "Authorization: Bearer mtb_…"`
   - Cursor and other config-file clients: the **MCP config** snippet in the side panel.
   - Claude.ai, ChatGPT and other URL-only connector screens: paste the **Connector URL**. These agents run in the cloud, so they need a relay with a public HTTPS address (below), not localhost.

## Deploy the relay

```bash
cd relay
docker build -t migma-tabs-relay .
docker run -p 8787:8787 -e PUBLIC_URL=https://tabs.example.com migma-tabs-relay
```

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | |
| `PUBLIC_URL` | `http://localhost:$PORT` | The address agents use; sent to the extension so the side panel shows correct connection details. |
| `RATE_LIMIT_PER_MINUTE` | `300` | MCP requests per agent per minute. |

Put it behind TLS with WebSocket upgrades allowed on `/extension`, then set the extension's relay to `wss://tabs.example.com/extension`. Routing is in memory, so run **one instance** (or add sticky routing / Redis pub-sub keyed by browser id before scaling out). `GET /health` reports connected browsers.

The relay is also a library: `createRelay()` returns `handleHttp` and `handleUpgrade`, so it can be mounted in an existing Node or Express server.

## Security model

- **No accounts, no database.** On install the extension makes a random `browserKey`. Its browser id is a hash of that key, so only that browser can register under it. Each agent token is `mtb_<browserId>.<secret>`; the relay only ever receives `sha256(secret)` from the browser, and only while the browser is online.
- **Revoking is instant.** Disconnecting an agent in the side panel removes its hash from the relay right away; its next request gets 401.
- **Per-site approval, per agent.** Listing tab titles needs no prompt; reading or acting on a site does. "Allow for 10 min" covers one agent; "Always allow", "Block" and "Allow every site" cover all agents. Blocked sites are hidden from `list_tabs`.
- **Read vs act.** Read-only agents do not even see the act tools. A pause switch stops every agent.
- **Visible.** A blue frame and a "Claude is using this tab" label show while an agent acts, opened tabs sit in the agent's group, and the activity list records every call, including failures.
- **Isolated.** The page agent runs in the extension's isolated world; pages cannot see or call it, and element refs are not written into the DOM. Only the extension's own pages can change settings.
- **Treat the Connector URL like a password**: the token is in the path. Prefer the header form when a client supports it.
- **The relay sees page content in transit.** Self-host it, or let Migma host it; end-to-end encryption between agent and browser is a possible later step.

## Known limits

- Clicks and keys are DOM events, not real input. Pages get no user activation, so `window.open` popups, some clipboard and file-picker flows, and sites that check `event.isTrusted` will not respond. Back and forward use the page's own `history.back()` because Chrome's back button skips entries created without a gesture. An optional Chrome debugger mode would fix this, at the cost of Chrome's "is debugging this browser" bar.
- Top frame only: iframes and closed shadow roots are not read. Canvas apps (Figma, Google Docs' editor surface) have no DOM text; Google Docs and Sheets go through their export endpoints instead. **Those readers are not yet tested against real Google accounts.**
- Word Online is read through its DOM like any page. Local `.docx` files and PDFs in Chrome's viewer are not supported yet.

## Tests

```bash
cd relay && yarn test            # 16 relay tests: routing, auth, read-only agents, offline, timeouts, spoofed results
cd relay && yarn build && cd ../e2e && yarn && xvfb-run -a node run.mjs
```

The end-to-end run loads the unpacked extension in real Chromium, drives the side panel like a user, connects two MCP agents, and checks 28 steps: prompts, reading, design extraction, screenshots, forms (including a React-style controlled input and a rich-text editor), navigation, tab groups, blocking, pause, relay restart and revoke. `SCREENSHOT_DIR=/some/dir` saves panel and prompt screenshots.

## Toward Migma

1. **Host the relay in migma-backend.** Mount `handleHttp` at `/browser/mcp` and `handleUpgrade` at `/browser/extension`, with Redis pub-sub because the backend runs several instances.
2. **Sign in with Migma instead of pasted tokens.** The extension signs into the user's Migma account; MCP clients that already use Migma's OAuth get the browser tools next to the `migma_*` tools.
3. **Give the design agent eyes.** `extract_design` on the brand's site feeds brand guidelines; `read_page` on a Google Doc or Word brief becomes the email brief; `screenshot` plus `extract_design` on inspiration sites become saved references; `get_selection` turns highlighted text into "write an email about this".
4. **Chrome Web Store listing** with a privacy policy and a single-purpose statement for the `<all_urls>` permission.
