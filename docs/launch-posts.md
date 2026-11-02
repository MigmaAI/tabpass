# Tabpass launch posts

Drafts only. Nothing here has been posted. Character counts treat each URL as 23 characters.

The landing page URL below is planned: `https://migma.ai/tabpass`. Publish posts using it only after the page is live. The [Chrome Web Store listing](https://chromewebstore.google.com/detail/tabpass/dfkcbinlgcemppeealhaicfdljcfnfdp) and [source repository](https://github.com/MigmaAI/tabpass) are the current public links.

## 1. Launch / remote agents

233 characters.

```text
Introducing Tabpass by MigmaAI. Open source.

Give Claude, Hermes, OpenClaw or Codex access to your Chrome browser over MCP.

Your agent can run elsewhere and still read pages, click and fill forms you allow.

https://migma.ai/tabpass
```

## 2. The browser you already use

236 characters.

```text
Your AI shouldn't need a fresh browser and another login.

Tabpass connects it to the Chrome tabs you're already using, signed in as you.

Ask it to read a page or handle a task. You choose the sites it can use.

https://migma.ai/tabpass
```

## 3. Your own agent server

233 characters.

```text
Hermes on a server. Chrome on your laptop.

Tabpass connects them over MCP, so your agent can work in your browser while it stays online.

No separate Tabpass account. No need to run the agent on your laptop.

https://migma.ai/tabpass
```

## 4. A concrete task

236 characters.

```text
“Use the docs in my open tabs to update this form.”

With Tabpass, your AI can read the pages you allow and enter the details in your browser.

Less copying between tabs. You choose read-only or browser control.

https://chromewebstore.google.com/detail/tabpass/dfkcbinlgcemppeealhaicfdljcfnfdp
```

## 5. Open source

222 characters.

```text
We open-sourced Tabpass: a Chrome extension and remote MCP server for giving AI agents access to your browser.

Use the hosted relay or run your own. Read the code, connect your agent, build on it.

https://github.com/MigmaAI/tabpass
```

## Short thread

### Post 1 of 4

219 characters.

```text
1/4 Your AI agent can run on a server. Your browser can stay on your laptop.

Tabpass connects them over MCP so the agent can use the pages you're already signed in to.

Open source, by MigmaAI.

https://migma.ai/tabpass
```

### Post 2 of 4

222 characters.

```text
2/4 Install Tabpass in Chrome. Create a connection and give it to your AI.

Choose Read or Read and act. Approve the sites it can use.

Now it can read docs, gather details, click buttons or fill forms, within that access.
```

### Post 3 of 4

236 characters.

```text
3/4 Work browser and personal browser? Give each one a separate, named MCP connection.

Ask your agent to use the right connection before listing tabs or taking action.

Each browser keeps its own access. Keep Chrome and Tabpass online.
```

### Post 4 of 4

221 characters.

```text
4/4 Hermes and OpenClaw support remote MCP. Claude and Codex can connect too.

No separate Tabpass account is needed for a private-link connection. Treat that link like a password.

Code and setup:
https://github.com/MigmaAI/tabpass
```

## Publishing notes

- Show a real permitted action in a short screen recording, such as reading an open documentation tab and filling a draft form. A draft is enough to demonstrate browser control.
- Chrome and Tabpass must stay running and online. A remote agent still needs a configured MCP connection or the ability to make the required HTTP calls.
- Tabpass separates **Read** from **Read and act** and asks before using a new site. Do not imply unrestricted access to every site.
- Private connection links are credentials. Mask them in recordings and screenshots. No separate Tabpass account is required for that connection method.
- Each browser or profile needs its own connection. Multiple named MCP servers let the agent choose the intended browser; one key does not discover every browser.
- Hermes and OpenClaw currently document native remote MCP support. The setup is [documented here](clients.md#hermes-agent); test the versions used in a demo before claiming a verified integration.
- These drafts promise no reach, engagement, or performance results. They are not Chrome Web Store metadata; keep the store description focused on the extension's function rather than lists of product names.
