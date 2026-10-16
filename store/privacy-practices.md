# Chrome Web Store: Privacy practices tab

Answers for every field of the **Privacy practices** tab in the developer dashboard. Paste each block as is. Each answer is short on purpose: reviewers read many of these, and the dashboard fields are small (keep each under 1,000 characters).

These answers describe the build in this repository. If a release adds a permission, a content script or a new kind of data leaving the browser, update this file and `PRIVACY.md` in the same change, and tell users in the extension before the new handling applies (Chrome Web Store disclosure policy, enforced since 1 August 2026).

Items marked **[confirm]** depend on work still in progress.

## Single purpose

```
Tabpass lets AI agents that the user connects (any MCP client, such as Claude, ChatGPT or Cursor) read and use the user's open Chrome tabs, with the user's approval for each site. Everything in the extension serves that purpose: the side panel to connect and remove agents, the per-site approval prompt, and the tools agents call (list tabs, read a page, read highlighted text, take a screenshot, and, if the user allows it, open tabs, click, type and scroll).
```

## Permission justifications

### tabs

```
Agents work with the user's open tabs. Tabpass reads tab titles and URLs to answer "list tabs", to check the site of a tab against the user's allowed and blocked sites before any access, and to report where a tab ended up after an action. With the user's "Read and act" choice, agents can also open, switch, reload and close tabs.
```

### tabGroups

```
Tabs an agent opens are placed in that agent's own named, colored tab group, so the user can see at a glance which tabs each agent is using. Agents with "Read and act" can also group or ungroup tabs, and "list tabs" reports each tab's group name.
```

### scripting

```
When an agent the user connected calls a tool on a tab, and the user has allowed that site, Tabpass injects its own packaged script (content/page-agent.js) into that tab to read the page text, find buttons and fields, click, type or scroll, and to show a visible frame with the agent's name while it acts. It injects nothing on sites the user has not allowed or has blocked, and never injects code from outside the package.
```

### storage

```
Stores the user's settings on their device: the relay address, the browser's name, the AI tools the user connected (name, access level, link, and the site that connected it, if any), the always-allowed and blocked site lists, an account connection if the user made one, and a log of the last 60 agent calls shown in the side panel. Session storage keeps 10-minute site grants, pending prompts and connection status until the browser closes.
```

### sidePanel

```
The side panel is Tabpass's interface. Clicking the toolbar icon opens it. There the user connects and disconnects agents, chooses read or act access, manages allowed and blocked sites, pauses all agents, and sees recent activity.
```

### alarms

```
A 30-second alarm wakes the service worker to check its connection to the relay and reconnect if it dropped. Without it, Manifest V3 suspends the worker and agents the user connected can no longer reach the browser. The alarm sends no data of its own.
```

### Host permission (`<all_urls>`)

The dashboard has one field for host permissions, which also covers the content script's matches. Paste both paragraphs.

```
The user decides which sites their agents may use, and that can be any site they work on, so the sites cannot be listed in advance. The host permission lets Tabpass run its packaged page script, capture the visible tab (captureVisibleTab) and read Google Docs and Sheets through their export address, only after a connected agent asks for that tab and the user has allowed that site in Tabpass's own prompt. Blocked sites are never touched and are hidden from agents. activeTab does not fit: agents work while the user is elsewhere, with no click on the tab.

Content script on all sites (content/bridge.js): a small script that lets a web page ask to connect as an AI tool. It answers a page only right after the user clicks on it, or if the user connected that site before, so pages cannot use it to detect Tabpass. It does not read page content and sends nothing to any server. A site is connected only after the user confirms in Tabpass's own window.
```

The script and its protocol are specified in `docs/web-protocol.md`. If it ever exposes more than "installed, version, connected, ask to connect", update this answer and `PRIVACY.md`.

### externally_connectable (migma.ai)

The dashboard does not list this as a permission; reviewers see it in the manifest. If asked, or in **Test instructions**, use:

```
The manifest reserves external messaging for https://migma.ai and its subdomains. Account providers are disabled in this release, so these messages cannot connect a Migma account. The separately documented web protocol still requires the user's confirmation in Tabpass's own window before connecting a website as an AI tool.
```

## Remote code

**Are you using remote code?** No.

```
No. All JavaScript runs from the extension package: the service worker, the side panel, the prompt window and the page script. The relay sends data only: a tool name and its arguments (for example "read_page" and a tab id) as JSON. Fixed handlers in the package run those calls. Tabpass never loads scripts from a server, never uses eval or new Function, and chrome.scripting only injects packaged files and functions.
```

## Data usage

**What user data do you plan to collect from users now or in the future?**

"Collect" here means data that leaves the browser. Tabpass sends it to the agents the user connected, through the relay the user configured, and only for the purpose above.

| Category | Check? | Why |
|---|---|---|
| Personally identifiable information | No | Tabpass never asks for a name or email. When the user connects a Migma account, Migma's site gives Tabpass the account's id, email and name, which stay on the device to show who is connected, and are only returned to migma.ai pages that ask (`tabpass.hello`). Personal details inside a page the user allows are covered by "Website content". |
| Health information | No | Not collected. Only appears if it is in a page the user allows (Website content). |
| Financial and payment information | No | Not collected. Same as above. |
| Authentication information | No | Tabpass does not read passwords: password fields are reported as `[hidden]`. The links and connection secrets it stores are Tabpass's own credentials, made by Tabpass or by Migma for this browser, not the user's passwords. |
| Personal communications | No | Tabpass does not target email or chat. If the user allows a mail or chat site, its text is sent as page text (Website content), only when an agent asks. **[confirm]** If the reviewer asks for it, check this box rather than argue. |
| Location | No | No GPS or location APIs. The relay, like any server, sees the connection's IP address; it does not store or use it to locate the user. |
| **Web history** | **Yes** | "List tabs" sends the titles and URLs of open tabs (blocked sites hidden) to a connected agent, and every page result names the page's title and URL. |
| User activity | No | Tabpass does not record the user's clicks, mouse, scrolling or keystrokes. Clicks and typing come from agents, not the user. The only signal is "this browser is in use" (sent at most every 30 seconds when the user switches to a Chrome window) so account calls go to the browser the person is using; it carries no page, click or key data. |
| **Website content** | **Yes** | Page text, form field values shown on the page (not passwords), highlighted text, screenshots of the visible tab, and a page's colors, fonts and image addresses, sent when a connected agent asks, on a site the user allowed. |

## Certifications

Check all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

The "approved use case" here is the user-facing feature itself: page data goes to the agent the user connected, at the user's request. The relay operator (Migma, on Cloudflare) handles it only to deliver it. Nothing is used for ads, sold or shared with data brokers.

## Privacy policy URL

```
https://migma.ai/tabpass/privacy
```

**[confirm]** Publish `PRIVACY.md` at this address before submitting (see `docs/publishing.md`). It must match these answers.

## Test instructions (for reviewers)

If the dashboard shows a **Test instructions** tab, paste:

```
No account is needed.
1. Install Tabpass and click its toolbar icon. The side panel opens and says "Connected". Click "Got it".
2. Click "Connect an AI tool", then "Make a link with a key". Type a name (for example "Reviewer"), keep "Read", click "Make the link", and copy it.
3. In a terminal, run the MCP Inspector: npx @modelcontextprotocol/inspector . Choose "Streamable HTTP", paste the link, and connect.
4. Call "list_tabs", then "read_page" with a tab id. Tabpass opens a window asking "Allow Reviewer to use <site>?". Choose "Allow for 10 minutes" and the page text comes back.
5. Call "read_page" on a tab of another site and choose "Block this site": that site disappears from list_tabs and later calls to it are refused.
Sign-in instead of a link: in the Inspector, connect to https://tabs.migma.ai/mcp. It opens the Tabpass sign-in page, and Tabpass opens a window to approve it.
```

**[confirm]** Run these steps against the store build and the hosted relay before submitting.
