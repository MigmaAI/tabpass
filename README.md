# Tabpass

**Your AI, your open tabs.** Tabpass lets Claude, ChatGPT, Cursor, Codex, Migma or any other MCP client read and use the Chrome tabs you already have open, signed in as you. You approve each new site.

Open source (MIT), by the [Migma](https://migma.ai) team.

<p align="center"><img src="store/images/01-home.png" alt="The Tabpass side panel next to a shop page: three AI tools and recent activity" width="720"></p>

It follows the structure of OpenAI's ChatGPT Chrome extension: a side panel, per-site approval, a tab group per tool, and read vs act. The difference is that the browser is reached through a **remote MCP server**, so any AI tool can use it, from anywhere.

```
 AI tools ── MCP over HTTPS ──┐   websites ── Tabpass Web Protocol ──┐   Migma ── server to server ──┐
 one URL, OAuth sign-in        │   (connect in one click)            │                                │
                               ▼                                      ▼                                ▼
                     relay/   tabs.migma.ai: Cloudflare Worker (or Node), MCP + OAuth + /internal
                                │  a WebSocket the browser opens outward (works behind any NAT)
                                ▼
                     extension/   Chrome MV3: side panel, site approval, 15 tools
```

## Paste a prompt. Use your browser.

1. Open Tabpass and choose **Create connection prompt**.
2. Name the connection and choose **Read** or **Read and act**. Read is the default.
3. Choose **Copy connection prompt** and paste it into an AI that can call MCP servers or make HTTP requests.
4. Ask it to help with your open tabs. Tabpass asks before it reads or uses each new website.

No separate Tabpass account or sign-in is needed. Your AI uses pages in the browser where Tabpass is installed, including websites you are already signed into.

The prompt contains a private access link. Anyone with it can use the access you chose. Keep it out of public chats and shared documents. Remove the connection in Tabpass to revoke it.

Some AI apps need a connector configured before they can use browser tools. **App setup options** keeps those guides and the OAuth server URL, `https://tabs.migma.ai/mcp`. A participating website can also offer its own Connect button.

The prompt-first extension UI is a local update awaiting release. Existing versions expose the same private links through **Make a link with a key**.

Step-by-step guides: [docs/clients.md](docs/clients.md). Agents that read docs can start at `https://tabs.migma.ai/llms.txt`.

## Ways to connect

| | How | Who it acts as |
|---|---|---|
| **App setup** (OAuth) | Add `https://tabs.migma.ai/mcp`, approve in Tabpass's window | The tool's name, with the access you picked |
| **Private connection prompt** | Create a connection, then paste its prompt into a capable AI | The name you typed |
| **Website** | The site's "Connect your browser" button, then confirm in Tabpass | The site's name; its authenticated backend gets a token for its MCP client ([Web Protocol](docs/web-protocol.md), [`@migma/tabpass-connect` browser SDK](connect/README.md)) |

Migma's new **Connect browser** flow uses the public Web Protocol SDK. It belongs to the signed-in person, not a brand: the page hands the approved credential to Migma's authenticated backend, which verifies the MCP connection before saving it. Only that person can offer the browser tools in a live Migma design turn. The implementation is local and still requires the Migma frontend and backend release before it is available in production.

The separate Migma **account connection** remains available in development builds only; the store build does not show its account Connect row.

The personal SDK flow also binds a browser to one **person**, never to an org. Teammates and admins do not inherit it through a shared brand. See [docs/migma-integration.md](docs/migma-integration.md) for Migma's local implementation, and [docs/accounts.md](docs/accounts.md) for the separate provider-account prototype.

## Tools

| Tool | Level | What it does |
|---|---|---|
| `list_tabs` | read | Tabs in every window: id, title, URL, active, groups. Blocked sites are hidden. No prompt. |
| `read_page` | read | Clean text (headings, lists, links, tables). `interactive=true` adds buttons and fields with refs. Google Docs and Sheets are read through their export. |
| `get_selection` | read | The text the person highlighted. |
| `screenshot` | read | Visible part of a tab as JPEG or PNG. |
| `extract_design` | read | Palette with roles, fonts, type scale, button styles, radii, content width, logo, key images. |
| `wait_for` | read | Wait for a load, or for text to appear. |
| `open_tab`, `navigate`, `activate_tab`, `close_tabs`, `group_tabs` | act | Tab management. Opened tabs go into the tool's own tab group. |
| `click`, `type`, `press_key`, `scroll` | act | Act by ref, CSS selector, or visible text. |
| `list_browsers` | account | A person's connected browsers. Other tools take `browser` to pick one; the default is the one used last. |

Every page result starts with a line marking the content as untrusted, and the server instructions tell tools never to follow instructions found in pages.

## Repository

```
relay/        TypeScript relay. src/core runs on Web APIs only, shared by both hosts:
                src/worker   Cloudflare Worker + Durable Objects (production, tabs.migma.ai)
                src/node     Node server and CLI (self-hosting, Docker, tests)
extension/    public/  service worker, tools, page agent, web protocol bridge, manifest (plain JS)
              src/     side panel and prompt windows: React 19, Tailwind v4, shadcn/ui
e2e/          real Chromium end to end, and the store image generator
connect/      zero-dependency TypeScript browser SDK for the web protocol
store/        Chrome Web Store listing, privacy answers and images
docs/         clients, web protocol, accounts, Migma integration, publishing
```

The UI is built on stock [shadcn/ui](https://ui.shadcn.com) and Radix primitives, laid out like iOS settings (grouped lists, a large title, push navigation, alert-style prompts) with Codex's monochrome actions. It follows Chrome's light or dark mode.

## Run it locally

```bash
yarn setup                                          # installs relay, extension and e2e
yarn --cwd relay build && RELAY_SECRET=$(openssl rand -hex 32) yarn --cwd relay start   # http://localhost:8787
yarn --cwd extension build:dev                      # extension/dist, set to the local relay
```

1. Open `chrome://extensions`, turn on Developer mode, **Load unpacked**, and pick `extension/dist`.
2. Click the toolbar icon. The panel connects to `ws://localhost:8787/extension` (change it under **Settings**).
3. Connect a tool on this computer with `http://localhost:8787/mcp`, for example `claude mcp add --transport http tabpass http://localhost:8787/mcp`. Cloud tools (Claude.ai, ChatGPT) connect from their own servers, so they need a relay with a public HTTPS address.

`yarn --cwd extension watch` rebuilds on change. `yarn --cwd extension build` makes the store build, which uses `wss://tabs.migma.ai/extension`.

## Deploy the relay

### Cloudflare Workers (what tabs.migma.ai runs)

Each browser lives in its own Durable Object holding its WebSocket (with hibernation, so idle browsers cost nothing), and each person's browser list in another. Nothing else is stored: no page content, no tokens (only hashes).

```bash
cd relay
npx wrangler secret put RELAY_SECRET            # 32+ random characters; keep it stable or sign-ins break
npx wrangler secret put INTERNAL_SECRET         # only for an account provider such as Migma
npx wrangler secret put ACCOUNTS_VERIFY_SECRET  # same
yarn deploy:worker
```

Set `PUBLIC_URL`, and `ACCOUNTS_VERIFY_URL` for account mode, under `[vars]` in `relay/wrangler.toml`. The custom domain route is configured for `tabs.migma.ai`; its zone must belong to the Cloudflare account used to deploy.

### Node or Docker

```bash
docker build -t tabpass-relay relay
docker run -p 8787:8787 -e PUBLIC_URL=https://tabs.example.com -e RELAY_SECRET=… tabpass-relay
```

| Variable | Default | |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:$PORT` | The address tools use. Sign-in redirects and links are built from it. |
| `RELAY_SECRET` | random, with a warning | Signs OAuth clients and codes. Without a stable value, every restart signs every tool out. |
| `PORT`, `HOST` | `8787`, `127.0.0.1` (`0.0.0.0` in Docker) | |
| `INSTALL_URL` | the Chrome Web Store listing | Where the sign-in page sends people without Tabpass. |
| `RATE_LIMIT_PER_MINUTE` | `300` | MCP requests per tool per minute. |
| `ACCOUNTS_VERIFY_URL`, `ACCOUNTS_VERIFY_SECRET` | off | Account mode: where the relay checks browser connections. |
| `INTERNAL_SECRET` | off | Turns on `/internal` for the account provider's servers. |

Put it behind TLS with WebSocket upgrades on `/extension`. The Node relay keeps routing in memory, so run **one instance**. `GET /health` reports browsers, accounts and pending calls. It is also a library: `createRelay()` returns `handleHttp` and `handleUpgrade`, and `registerBrowserTools()` adds the browser tools to any MCP server.

## Security model

- **Nothing to steal on the relay.** The extension makes a random key on install, and shows each relay a key derived for that relay alone, so a relay (and any website that asks to be one) cannot pose as the browser elsewhere. A tool's token is `tp_<browserId>.<secret>`; the relay only ever sees `sha256(secret)`. OAuth clients and codes are signed and sealed with `RELAY_SECRET`, and codes work once.
- **You approve, in Tabpass's own window.** Signing in, a website's connect request and Migma's connect all open a Tabpass window that a page cannot draw over or click for you. A page can only ask after the person's click.
- **Per-site approval.** Listing tab titles needs no prompt; reading or acting on a site does. **Always allow** applies to every tool you connect; **Allow for 10 minutes** to that tool only. Blocked sites are hidden from `list_tabs`.
- **Read means read.** Tools with Read access do not even see the act tools. A switch in the header pauses every tool.
- **Not detectable by websites.** The web protocol answers a site only after a click on its page, or if you connected it before.
- **Revoking is immediate for direct tools.** A disconnected tool's next request gets 401. Migma's personal flow separately removes its encrypted server-side credential and the site can remove its Tabpass grant with the Web Protocol.
- **Outages never disconnect people.** A provider outage or a wrong relay secret counts as "unavailable", never as "revoked".
- **Visible.** While a tool acts, a blue frame and a "Claude is using this tab" label show on the page, and the activity list records every call, including failures.
- **Isolated.** The page agent runs in the extension's isolated world; pages cannot see or call it, and element refs are never written into the DOM.
- **Treat a token like a password.** The relay sees page content in transit (it does not store it), so self-host it if that matters to you.

## Publishing

Store copy, privacy answers and images are in [`store/`](store); the steps (developer account, privacy policy, CI upload) are in [docs/publishing.md](docs/publishing.md). The store images are made from the production build:

```bash
yarn --cwd relay build && cd e2e && xvfb-run -a node store-assets.mjs
```

## Known limits

- Clicks and keys are DOM events, not real input, so pages get no user activation. `window.open` popups, some clipboard and file-picker flows, and sites that check `event.isTrusted` will not respond.
- Top frame only: no iframes or closed shadow roots. Canvas apps have no DOM text. The Google Docs and Sheets readers use their export endpoints and **are not yet tested against real Google accounts**.
- Local `.docx` files and PDFs in Chrome's viewer are not supported yet.

## Tests

```bash
yarn test                         # relay tests (40) + typechecks
yarn --cwd relay test:worker      # the same relay on workerd, the Cloudflare runtime (8)
yarn test:e2e                     # 15 end-to-end steps in real Chromium (needs xvfb)
```

The end-to-end run loads the built extension and drives it like a person would:

- the side panel, link-with-a-key tools, reading, clicking and typing, and site prompts;
- an MCP client signing in with one URL through the OAuth page;
- a website connecting through the web protocol, without being able to detect Tabpass first;
- the whole Migma flow against a fake Migma: one click, cancel, foreign relays refused, revocation;
- pause, sites, dark mode, a relay restart, and disconnecting.

`SCREENSHOT_DIR=/some/dir` saves a screenshot of every screen and prompt.
