# Chrome Web Store listing: Tabpass

Copy each block into the **Store listing** tab of the [developer dashboard](https://chrome.google.com/webstore/devconsole). Rules the copy follows: say what the person gets, use short plain words, and claim nothing the extension does not do. Check every claim against the code before changing it.

Items marked **[confirm]** are placeholders or decisions the Migma team still has to make.

## Name

```
Tabpass
```

Comes from `name` in `extension/public/manifest.json` (the dashboard reads it from the package, so change it there).

## Summary (132 characters max)

The dashboard takes the summary from `description` in `extension/public/manifest.json`, which already holds this text (111 characters). Change it there, not in the dashboard.

```
Let Claude, ChatGPT, Cursor or any AI tool read and use your open tabs. You approve each new site. Open source.
```

## Description

Plain text. The store does not render Markdown, so paste it as is.

```
Your AI can work with the pages you already have open, signed in as you, instead of you copying and pasting. You approve each new site first.

Tabpass connects your open Chrome tabs to AI agents through MCP (Model Context Protocol). It works with Claude, ChatGPT, Cursor, Claude Code, Codex and any other tool that can add an MCP server.

HOW IT WORKS
1. Open the Tabpass side panel and click "Connect an AI tool".
2. Add the one Tabpass link to your AI tool. Claude, Cursor and VS Code have an "Add" button; the others take a few steps, shown in the panel.
3. Your tool asks you to sign in. Tabpass opens its own window: choose "Read" or "Read and act", then "Connect".
4. The first time the tool wants a site, Tabpass asks you: "Always allow", "Allow for 10 minutes", "Don't allow" or "Block this site".

Tools without sign-in get their own link with a key instead.

Some AI websites can connect from their own page, in one click. Tabpass still asks you first, in its own window.

WHAT A TOOL CAN DO
With Read:
- see the titles and addresses of your open tabs
- read the text of a page, including tables and links
- read the text you highlighted
- take a screenshot of the visible part of a tab
- read a page's colors, fonts and layout

With Read and act, also:
- open, switch, group and close tabs
- click, type, press keys and scroll

YOU STAY IN CONTROL
- AI tools can see the titles and addresses of your tabs. To read or use a page, they need your OK for that site.
- Blocked sites are hidden from them.
- A "Read" tool cannot click or type.
- One switch pauses every tool.
- While a tool acts on a tab, a blue frame and its name show on the page.
- The activity list shows every call, including failed ones.
- Disconnect a tool and it loses access at once.
- Websites cannot tell Tabpass is installed until you click their connect button.

PRIVACY
- Page content leaves your browser only when an AI tool you connected asks for it, on a site you allowed. Blocked sites, never.
- Tab titles and addresses are shared when a tool you connected lists your tabs.
- It all goes through the relay to that tool. The relay passes it on and does not store it.
- The default relay is run by Migma. You can run your own and point Tabpass at it.
- No ads, no analytics, no tracking. We do not sell your data.
- Full policy: https://migma.ai/tabpass/privacy

GOOD TO KNOW
- Clicks and typing are page events, not real input, so a few sites ignore them, and pop-up windows may not open.
- Tabpass reads the main page only, not frames inside it. PDFs in Chrome's viewer are not supported yet.
- Chrome does not let any extension read chrome:// pages or the Chrome Web Store.

Tabpass is open source (MIT): https://github.com/migmaai/tabpass
Made by Migma (https://migma.ai). Tabpass is not made by, or affiliated with, Anthropic, OpenAI or Cursor.
```

Before pasting, check:

- **[confirm]** The privacy policy URL is live (see `docs/publishing.md`, "Host the privacy policy") and matches the line above.
- **[confirm]** `https://github.com/migmaai/tabpass` is the public repository address.
- If the Google Docs and Sheets readers are still untested against real accounts at submission time (see README, "Known limits"), drop that line rather than promise it.
- Keep the list of AI tools short and accurate. Store policy treats long keyword lists as spam.

## Category

```
Productivity > Tools
```

**[confirm]** The store groups extensions under Productivity, Lifestyle and "Make Chrome Yours". "Tools" fits the main audience (people using AI tools). "Developer Tools" is the alternative if most installs come from MCP developers. Pick in the dashboard drop-down; the list there is the source of truth.

## Language

```
English
```

## URLs

| Field | Value | |
|---|---|---|
| Official URL | `migma.ai` | Shown only after migma.ai is verified in Google Search Console with the publisher's Google account (see `docs/publishing.md`). **[confirm]** |
| Homepage URL | `https://github.com/migmaai/tabpass` | **[confirm]** placeholder; a page on migma.ai (e.g. `https://migma.ai/tabpass`) is better once it exists. |
| Support URL | `https://github.com/migmaai/tabpass/issues` | **[confirm]** placeholder; must be public before submission. |
| Privacy policy URL | `https://migma.ai/tabpass/privacy` | Goes in the **Privacy practices** tab. **[confirm]** host `PRIVACY.md` there first. |

## Images

| Asset | Size | Required | Source |
|---|---|---|---|
| Store icon | 128x128 PNG | Yes | `extension/public/icons/icon-128.png` (is 128x128). Google recommends 96x96 artwork with 16px transparent padding, so check it does not look cramped next to other icons. |
| Screenshots | 1280x800 (preferred) or 640x400, PNG or JPEG, square corners, no padding | At least 1, up to 5 | Plan below |
| Small promo tile | 440x280 PNG or JPEG | Yes | `store/images/promo-small-440x280.png`: icon and name on flat zinc, "Your AI, your open tabs." |
| Marquee promo tile | 1400x560 PNG or JPEG | No | `store/images/promo-marquee-1400x560.png`, same style. Only used if the store features Tabpass. |
| Promo video | YouTube URL | No | Skip for the first release. |

Promo images must not claim store status ("Editor's choice", "#1") and should not use other companies' logos.

## Screenshots

Five 1280x800 PNGs in `store/images/`, made from the **production build** by a script that drives the real extension:

```bash
yarn --cwd relay build && cd e2e && xvfb-run -a node store-assets.mjs
```

It serves the relay as `https://tabs.migma.ai` and two made-up sites (`northwind.studio`, and `chatgpt.com` only as the sign-in's return address) from the local machine, connects three tools, and photographs the side panel and Tabpass's windows. Nothing goes to the internet, and every name and address in the images is made up or Migma's own. Run it again after any UI change, so the images match the build you submit.

| File | Caption (in the image) | What it shows |
|---|---|---|
| `01-home.png` | Your AI, your open tabs. | Home: three AI tools and recent activity, next to a shop page. |
| `02-connect.png` | One link connects any AI tool. | "Connect an AI tool": the one link and the popular tools with Add buttons. |
| `03-approve-sites.png` | You approve each new site. | "Allow Claude to use northwind.studio?" with Always allow, Allow for 10 minutes, Don't allow, Block this site. |
| `04-sign-in.png` | Sign in once. You choose what it can do. | ChatGPT signing in: the sign-in page, and Tabpass's window with Read or Read and act. |
| `05-dark.png` | Light or dark, it follows Chrome. | Home in dark mode. |

Upload them in this order. Screenshots show the provider icons bundled in the extension. Promo tiles use only Tabpass's own name and icon.
