# Chrome Web Store listing: Tabpass

Copy each block into the **Store listing** tab of the [developer dashboard](https://chrome.google.com/webstore/devconsole). Rules the copy follows: say what the person gets, use short plain words, and claim nothing the extension does not do. Check every claim against the code before changing it.

Items marked **[confirm]** are placeholders or decisions the Migma team still has to make.

## Name

```
Tabpass
```

Comes from `name` in `extension/public/manifest.json` (the dashboard reads it from the package, so change it there).

## Summary (132 characters max)

The dashboard takes the summary from `description` in `extension/public/manifest.json`. To use the text below, put it in the manifest before you build.

```
Let Claude, ChatGPT, Cursor or any MCP agent read and use your open tabs. You approve each new site first. Open source.
```

119 characters. The current manifest text also works (104 characters):

```
Let any AI agent read and use your open tabs over MCP. You approve each new site. Open source, by Migma.
```

## Description

Plain text. The store does not render Markdown, so paste it as is.

```
Your AI can work with the pages you already have open, signed in as you, instead of you copying and pasting. You approve each new site first.

Tabpass connects your open Chrome tabs to AI agents through MCP (Model Context Protocol). It works with Claude, ChatGPT, Cursor, Claude Code, Codex and any other tool that can add an MCP server.

HOW IT WORKS
1. Open the Tabpass side panel and click "Connect an agent".
2. Give it a name and choose "Read" or "Read and act".
3. Paste the link Tabpass shows into your AI tool.
4. The first time the agent wants a site, Tabpass asks you. Pick "Always allow", "Allow for 10 min", "Decline" or "Block this site".

Use Migma? Click "Connect to Migma" and you are done in one click.

WHAT AN AGENT CAN DO
With Read:
- see the titles and addresses of your open tabs
- read the text of a page, including tables and links
- read the text you highlighted
- take a screenshot of the visible part of a tab
- read a page's colors, fonts and layout
- read Google Docs and Sheets you have open

With Read and act, also:
- open, switch, group and close tabs
- click, type, press keys and scroll

YOU STAY IN CONTROL
- Agents can see the titles and addresses of your tabs. To read or use a page, they need your OK for that site.
- Blocked sites are hidden from agents.
- A "Read" agent cannot click or type.
- One switch pauses every agent.
- While an agent acts on a tab, a blue frame and its name show on the page.
- The activity list shows every call, including failed ones.
- Disconnect an agent and it loses access at once.

PRIVACY
- Page content leaves your browser only when an agent you connected asks for it, on a site you allowed. Blocked sites, never.
- Tab titles and addresses are shared when an agent you connected lists your tabs.
- It all goes through the relay to that agent. The relay passes it on and does not store it.
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
| Small promo tile | 440x280 PNG or JPEG | Yes | Tabpass icon and name on a flat zinc background, one short line: "Your AI, your open tabs." No screenshots, little text. |
| Marquee promo tile | 1400x560 PNG or JPEG | No | Only used if the store features Tabpass. Same style as the small tile. Make it later. |
| Promo video | YouTube URL | No | Skip for the first release. |

Promo images must not claim store status ("Editor's choice", "#1") and should not use other companies' logos.

## Screenshot plan

Five screenshots, 1280x800 each. Each one shows a real Chrome window with a neutral demo site on the left and the Tabpass side panel on the right, in light mode except number 5. Use only made-up content: a demo site you own, a demo email like `alex@example.com`, and no real people's data. The panel and prompt windows can be captured with the end-to-end run (`SCREENSHOT_DIR=/some/dir yarn test:e2e`) and placed on a 1280x800 canvas. Captions go in the image, at the top, in one short line.

| # | Caption (in the image) | What it shows |
|---|---|---|
| 1 | Your AI, your open tabs. | **Home side panel.** The header with the "On" switch, the Migma card ("Connected as alex@example.com"), the Agents card with two agents ("Claude", "Cursor") and a "Connected" badge, and a short Activity list (read_page, screenshot) next to an ordinary demo page. |
| 2 | Connect any AI tool in seconds. | **Connect an AI tool.** "Connect an agent" open: the name field with the Claude / ChatGPT / Cursor / Codex chips, the Read or Read and act choice, and the link to copy after "Connect". |
| 3 | You approve each new site. | **Site approval prompt.** The Tabpass window "Allow Claude to use example.com?" with "Always allow", "Allow for 10 min", "Decline", and "Block this site" below, over the demo page. |
| 4 | Use Migma? One click. | **Migma one-click connect.** The Migma card with "Connect to Migma", and after it, the card showing "Connected as alex@example.com". Use a Migma test account, never a real customer's. |
| 5 | Light or dark, it follows Chrome. | **Dark mode.** The same panel as screenshot 1 with the system set to dark, next to a dark demo page. |

Optional extra if a slot frees up later: the blue "Claude is using this tab" frame on a page while an agent clicks, which shows people what acting looks like.

Before uploading, check every screenshot against the build you submit: labels, buttons and wording must match the real UI.
