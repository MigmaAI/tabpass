# Connect any AI tool

Start with **Create connection prompt** in Tabpass. Name the connection, choose **Read** or **Read and act**, then copy the prompt and paste it into an AI that can call MCP servers or make HTTP requests. No separate Tabpass sign-in is needed.

The prompt carries a private access link. Keep it out of public chats and shared documents. **Disconnect** in Tabpass revokes access. Copying the prompt does not prove your AI connected: check the connection's **Last used** and Tabpass's activity after asking it to list your tabs.

Some apps need connector setup first. **App setup options** in the side panel links to the guides below. For OAuth, add `https://tabs.migma.ai/mcp` as a remote MCP server and approve the connection in Tabpass. Migma has a dedicated [Connect browser action](#migma).

For manual setup, create a connection prompt, then open **Advanced setup** to copy its private server URL, header or config (see [Tools without OAuth](#tools-without-oauth)).

Two things to know first:

- **Cloud tools need a public address.** Claude (web, desktop and phone apps), ChatGPT, Perplexity and Le Chat connect from their own servers, never from your computer, so `localhost` does not work for them. Use an HTTPS relay. Tools on your computer (Claude Code, Codex, Cursor, VS Code and the rest) can use `localhost`.
- **Menus move.** Paths below were checked in October 2026. Entries marked *Not verified* come from secondary sources; check the tool's docs if a step does not match.

The extension's MCP client guides come from `extension/src/lib/clients.ts`.

---

## Migma

1. Install and enable Tabpass in the Chrome profile where you use Migma. Use the default relay, `https://tabs.migma.ai`.
2. Sign in to Migma and open **Tools and connectors → Connect browser** in a design chat.
3. Click **Connect browser** in the dialog, then approve in Tabpass's own window. **Read** is the default; you can choose **Read and act**.
4. Wait for Migma to verify the connection and show Connected. No server URL or key needs copying. Keep **Use connectors** enabled when asking Migma to use your tabs.

This is a personal connection for your live design chats. Other members of a shared brand cannot use it. Page content added to a chat is visible to anyone with access, including public viewers if you share the chat publicly. Tabpass still asks before reading or acting on a new site; listing tab titles and URLs needs no site prompt.

Open the same dialog to reconnect or disconnect. Disconnecting removes Migma's saved credential; it leaves existing chat content and the extension grant in place. You can remove that grant in Tabpass's side panel.

Brand-level custom MCP connectors are separate and follow the brand's permissions. Migma's personal connection uses the [public Web Protocol SDK](../connect/README.md), not the development-only provider-account mode. See the [integration guide](migma-integration.md) for the architecture and security boundaries.

## Claude (web, desktop and phone)

One-click link (opens the **Add custom connector** dialog with Tabpass filled in; you still review and confirm):

```
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Tabpass&connectorUrl=https%3A%2F%2Ftabs.migma.ai%2Fmcp
```

By hand:

1. Open Claude → **Customize → Connectors**.
2. Click **Add custom connector**.
3. Name it `Tabpass`, paste `https://tabs.migma.ai/mcp`, and click **Add**. If Claude asks how it should identify itself, choose **Register automatically** (DCR).
4. Click **Connect**, then approve in Tabpass.

Connectors you add on claude.ai also show up in Claude Desktop and the phone apps. Free plans can add one custom connector. On Team and Enterprise plans an Owner adds it under **Organization settings → Connectors** (`https://claude.ai/admin-settings/connectors?modal=add-custom-connector&…` takes the same parameters), then each member clicks **Connect**.

## ChatGPT

*Partly verified: menu names changed several times in 2026.*

1. In ChatGPT settings, turn on **Developer mode** (recently under **Security and login**; older accounts: **Apps → Advanced settings**).
2. Open **Plugins** (older accounts: **Apps**), click **Add**, then **Create MCP App**.
3. Name it `Tabpass`, paste `https://tabs.migma.ai/mcp`, and choose **OAuth**.
4. Click **Create**, then approve in Tabpass. In a chat, turn the app on from the **+** menu.

Web only. OpenAI's help center lists Business, Enterprise and Edu for full MCP apps; its developer guide also lists Plus and Pro. ChatGPT supports DCR and Client ID Metadata Documents.

## Cursor

One-click link (the config is base64 of `{"url":"https://tabs.migma.ai/mcp"}`):

```
cursor://anysphere.cursor-deeplink/mcp/install?name=tabpass&config=eyJ1cmwiOiJodHRwczovL3RhYnMubWlnbWEuYWkvbWNwIn0%3D
```

The web form, which the extension uses, takes the same parameters: `https://cursor.com/en/install-mcp?name=tabpass&config=…`.

By hand, add this to `~/.cursor/mcp.json`, then approve in Tabpass when Cursor opens the browser:

```json
{
  "mcpServers": {
    "tabpass": { "url": "https://tabs.migma.ai/mcp" }
  }
}
```

Cursor signs in with OAuth when the server has no `headers`. Its fixed redirect URI is `cursor://anysphere.cursor-mcp/oauth/callback`.

## Claude Code

```bash
claude mcp add --transport http --scope user tabpass https://tabs.migma.ai/mcp
claude mcp login tabpass        # or run /mcp inside a session and pick tabpass
```

`--scope user` makes Tabpass available in every project (the default, `local`, is the current project only). Claude Code uses a loopback redirect (`http://localhost:<any port>/callback`).

## Codex (CLI, IDE extension and app)

```bash
codex mcp add tabpass --url https://tabs.migma.ai/mcp
```

Codex detects OAuth and opens the browser right away. If it does not, run `codex mcp login tabpass`. This writes `~/.codex/config.toml`, which the CLI, the IDE extension and the Codex app share:

```toml
[mcp_servers.tabpass]
url = "https://tabs.migma.ai/mcp"
```

In the Codex app you can also go to **Settings → MCP servers → Add server**, then **Authenticate**.

## VS Code (GitHub Copilot)

One-click link (`vscode:` for Stable, `vscode-insiders:` for Insiders; the JSON is URL-encoded):

```
vscode:mcp/install?%7B%22name%22%3A%22tabpass%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Ftabs.migma.ai%2Fmcp%22%7D
```

The web form, which the extension uses: `https://insiders.vscode.dev/redirect/mcp/install?name=tabpass&config=<URL-encoded {"type":"http","url":"…"}>` (add `&quality=insiders` for Insiders).

By hand: **Command Palette → MCP: Add Server → HTTP**, paste the link, name it `tabpass`, and save it to **Copilot Global** (`~/.copilot/mcp-config.json`, shared with Copilot CLI). Or from a terminal:

```bash
code --add-mcp '{"name":"tabpass","type":"http","url":"https://tabs.migma.ai/mcp"}'
```

VS Code tries DCR first and opens the browser on first use.

## Gemini CLI

```bash
gemini mcp add --transport http --scope user tabpass https://tabs.migma.ai/mcp
```

Then, inside Gemini CLI: `/mcp auth tabpass`. The default scope is `project`, so pass `--scope user` to use Tabpass everywhere. This writes `"httpUrl"` in `~/.gemini/settings.json`. Gemini CLI redirects to `http://localhost:<random port>/oauth/callback` and checks the `iss` parameter on the callback.

## Windsurf (now Devin Desktop)

*Not verified against the official page; this changes often.*

In the agent panel, open **MCPs → Configure** (the file is `~/.codeium/windsurf/mcp_config.json`), add this, save, and click **Refresh**:

```json
{
  "mcpServers": {
    "tabpass": { "serverUrl": "https://tabs.migma.ai/mcp" }
  }
}
```

Windsurf's docs say remote servers support OAuth. Windsurf was renamed Devin Desktop in June 2026; the newer Devin CLI keeps its own `~/.config/devin/mcp_config.json` and has `devin mcp add tabpass <url>`.

## GitHub Copilot CLI

```bash
copilot mcp add --transport http tabpass https://tabs.migma.ai/mcp
```

Then, inside `copilot`: `/mcp auth tabpass`. Config: `~/.copilot/mcp-config.json` (the same file VS Code calls Copilot Global). Copilot CLI uses DCR unless you set `oauthClientId`.

## Zed

Run **zed: open settings file** and add:

```json
{
  "context_servers": {
    "tabpass": { "url": "https://tabs.migma.ai/mcp" }
  }
}
```

With no `Authorization` header, Zed runs the MCP OAuth flow (CIMD first, then DCR). The same entry can be made from **Settings → AI → MCP Servers → Add Server → Add Remote Server**.

## Cline

In Cline: **MCP Servers → Remote Servers**, name `tabpass`, paste the link, choose **Streamable HTTP**, click **Add Server**, then **Authenticate**. In JSON (`cline_mcp_settings.json`), set the type, or Cline falls back to legacy SSE:

```json
{
  "mcpServers": {
    "tabpass": { "type": "streamableHttp", "url": "https://tabs.migma.ai/mcp" }
  }
}
```

Cline CLI: `cline mcp add tabpass https://tabs.migma.ai/mcp --transport http --yes`, then **Authorize OAuth** in `cline mcp`.

## Goose

One-click link (every value URL-encoded):

```
goose://extension?type=streamable_http&url=https%3A%2F%2Ftabs.migma.ai%2Fmcp&id=tabpass&name=Tabpass&description=Read%20and%20use%20your%20browser%20tabs
```

By hand: **Extensions → Add custom extension → Streamable HTTP**, or in `~/.config/goose/config.yaml`:

```yaml
extensions:
  tabpass:
    name: Tabpass
    type: streamable_http
    uri: https://tabs.migma.ai/mcp
    enabled: true
    timeout: 300
```

Goose gets a client by CIMD or DCR and redirects to `http://127.0.0.1:<random port>`.

## LM Studio

One-click link (the config is base64 of `{"url":"…"}`, then URL-encoded):

```
lmstudio://add_mcp?name=tabpass&config=eyJ1cmwiOiJodHRwczovL3RhYnMubWlnbWEuYWkvbWNwIn0%3D
```

The web form, which the extension uses: `https://lmstudio.ai/install-mcp?name=tabpass&config=…`. By hand: **Program tab → Install → Edit mcp.json**, then add `{"mcpServers":{"tabpass":{"url":"https://tabs.migma.ai/mcp"}}}`. LM Studio 0.3.17 or later; it signs in through the browser and uses `http://127.0.0.1:33389/mcp-oauth-callback`.

## OpenCode

*Secondhand (GitHub's install guide), not the OpenCode docs.*

In `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tabpass": { "type": "remote", "url": "https://tabs.migma.ai/mcp", "enabled": true }
  }
}
```

Then `opencode mcp auth tabpass`.

## Warp

*Secondhand.* Open **MCP Servers** (in Warp Drive or Settings), click **+ Add**, paste and save:

```json
{ "tabpass": { "url": "https://tabs.migma.ai/mcp" } }
```

Warp opens the browser to sign in. OAuth works for agents in the Warp app, not for Warp's cloud agents.

## Perplexity

*Not verified against Perplexity's own docs.* **Settings → Connectors → custom connector → Remote**, name `Tabpass`, paste the link, save, then connect and approve in Tabpass. Paid plans, web or desktop app. Perplexity uses DCR.

## Le Chat (Mistral)

*Not verified against Mistral's own docs.* **Intelligence → Connectors → Add connector → Custom MCP Connector**, name `Tabpass`, paste the link, and click **Connect**.

## JetBrains AI Assistant and Junie

*Not verified; this changes often.* AI Assistant can reach remote servers by URL but cannot sign in to them yet (JetBrains issue LLM-25012), so use a [token link](#tools-without-oauth):

**Settings → Tools → AI Assistant → Model Context Protocol (MCP) → Add → As JSON**:

```json
{
  "mcpServers": {
    "tabpass": { "url": "https://tabs.migma.ai/mcp/tp_…" }
  }
}
```

Junie reads the same JSON from `~/.junie/mcp/mcp.json`.

## Any other MCP tool

- If it takes a remote MCP URL, paste `https://tabs.migma.ai/mcp`. If it signs in through the browser, approve in Tabpass.
- If it only runs local (stdio) servers, bridge with [`mcp-remote`](https://github.com/geelen/mcp-remote), which does the OAuth flow itself (DCR, PKCE, tokens in `~/.mcp-auth`):

  ```json
  {
    "mcpServers": {
      "tabpass": { "command": "npx", "args": ["-y", "mcp-remote", "https://tabs.migma.ai/mcp"] }
    }
  }
  ```

  `http://localhost` works as is; other plain `http://` addresses need `--allow-http`.

---

## Tools without OAuth

Create a connection in the side panel with **Create connection prompt**, then open **Advanced setup**. Its token looks like `tp_<16 chars>.<43 chars>`. Keep it private: it opens your browser. Use it one of three ways.

**1. Header.** Send `Authorization: Bearer tp_…` with the universal URL:

```bash
claude mcp add --transport http --scope user tabpass https://tabs.migma.ai/mcp --header "Authorization: Bearer tp_…"
```

```json
{
  "mcpServers": {
    "tabpass": {
      "type": "http",
      "url": "https://tabs.migma.ai/mcp",
      "headers": { "Authorization": "Bearer tp_…" }
    }
  }
}
```

Other tools' header options: Codex `http_headers = { Authorization = "Bearer tp_…" }` or `--bearer-token-env-var` (Codex rejects an inline `bearer_token` for HTTP servers), Gemini CLI and Copilot CLI `--header "Authorization: Bearer tp_…"`, VS Code `"headers"` with an `${input:…}` prompt, Zed and LM Studio `"headers"`.

**2. Token link.** For screens that take only a URL, put the token in the path:

```
https://tabs.migma.ai/mcp/tp_…
```

**3. mcp-remote with a header**, for stdio-only tools. The value goes through an env var because some clients (Cursor, Codex, Claude Desktop on Windows) split arguments on spaces; `mcp-remote` expands `${VAR}` in headers itself:

```json
{
  "mcpServers": {
    "tabpass": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://tabs.migma.ai/mcp", "--header", "Authorization:${TABPASS_AUTH}"],
      "env": { "TABPASS_AUTH": "Bearer tp_…" }
    }
  }
}
```

`tokenSetup(mcpUrl, token)` in `clients.ts` returns all of these.

---

## Notes for the relay

What the clients above send or expect during sign-in:

- **Redirect URIs:** claude.ai, Desktop and mobile use `https://claude.ai/api/mcp/auth_callback`. ChatGPT uses `https://chatgpt.com/connector/oauth/{callback_id}` (legacy `https://chatgpt.com/connector_platform_oauth_redirect`). Cursor uses `cursor://anysphere.cursor-mcp/oauth/callback`. Claude Code, Gemini CLI, Goose, LM Studio, Codex and mcp-remote use loopback redirects on a random or fixed port, on `localhost` or `127.0.0.1`, so match loopback on any port for both names.
- **Client registration:** Claude, Zed and Goose prefer a Client ID Metadata Document when the server advertises one (`client_id_metadata_document_supported` and `none` in `token_endpoint_auth_methods_supported`), and fall back to DCR. With DCR only, Claude registers a new client on every fresh connection.
- **Claude:** needs a real `401` (it ignores `WWW-Authenticate` on a `200`), uses only the first `authorization_servers` entry, requires `resource` to equal the URL exactly as entered, sends PKCE S256 on every request, and refreshes up to 5 minutes before expiry. Return `invalid_grant` for a dead refresh token and rotate refresh tokens.
- **ChatGPT:** sends `resource=` on the authorize and token requests.
- **Gemini CLI:** checks `iss` on the callback when the server metadata sets `authorization_response_iss_parameter_supported: true`.
- **Claude Code:** sends credentials only to a token endpoint on HTTPS or on `localhost`.

## Sources

Checked October 2026. Official docs read in full from the source repository or the vendor's page:

- Claude custom connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Claude connector install links: https://claude.com/docs/connectors/building/directory-vs-custom
- Claude connector authentication: https://claude.com/docs/connectors/building/authentication
- Claude add a connector by URL: https://claude.com/docs/connectors/custom/add-unlisted
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Codex CLI source (`codex mcp add`, `codex mcp login`, config fields): https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs and https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs
- VS Code MCP install URL and OAuth: https://github.com/microsoft/vscode-docs/blob/main/api/extension-guides/ai/mcp.md
- VS Code MCP configuration: https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/mcp-configuration.md and https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/mcp-servers.md
- Gemini CLI MCP: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
- Zed MCP: https://github.com/zed-industries/zed/blob/main/docs/src/ai/mcp.md
- Cline MCP: https://github.com/cline/cline/blob/main/docs/mcp/mcp-overview.mdx
- Goose extensions and deeplinks: https://github.com/block/goose/blob/main/documentation/docs/getting-started/using-extensions.md
- LM Studio MCP, deeplink and OAuth: https://github.com/lmstudio-ai/docs (`0_app/2_mcp/`, `4_integrations/1_mcp-remote/index.md`)
- GitHub Copilot CLI MCP: https://github.com/github/docs/blob/main/content/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers.md and `content/copilot/reference/copilot-cli-reference/cli-command-reference.md`
- mcp-remote: https://github.com/geelen/mcp-remote (README and `src/lib/utils.ts`, v0.1.38)
- GitHub MCP server install guides (Cursor web link, Windsurf, OpenCode, Copilot CLI shapes): https://github.com/github/github-mcp-server/tree/main/docs/installation-guides

Secondary (search results and vendor guides; the official page could not be loaded from here):

- Cursor install links and MCP: https://cursor.com/docs/mcp/install-links, https://cursor.com/docs/mcp, https://forum.cursor.com/t/mcp-installation-deeplink-broken/167870
- Cursor OAuth redirect URI: https://docs.domaintools.com/mcp/oauth/
- ChatGPT developer mode: https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta, https://developers.openai.com/api/docs/guides/developer-mode, https://developers.openai.com/apps-sdk/build/auth, https://community.openai.com/t/create-mcp-app-missing-from-plugins-menu-on-personal-chatgpt-accounts/1401436
- Codex app and IDE extension: https://developers.openai.com/codex/mcp
- Windsurf / Devin Desktop: https://docs.windsurf.com/windsurf/cascade/mcp, https://docs.devin.ai/desktop/cascade/mcp, https://docs.devin.ai/cli/reference/configuration/config-file
- Warp: https://docs.warp.dev/knowledge-and-collaboration/mcp
- Perplexity: https://hjarni.com/docs/connect-perplexity-mcp, https://agents.ramp.com/docs/connectors/perplexity
- Le Chat: https://tallyfy.com/how-to-list-mcp-server-mistral-le-chat/, https://docs.civic.com/civic/quickstart/clients/mistral-lechat
- JetBrains AI Assistant: https://www.jetbrains.com/help/ai-assistant/mcp.html, https://youtrack.jetbrains.com/projects/LLM/issues/LLM-25012/OAuth2-Authentication-for-MCP-Server-Connections
- Junie: https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html

### Not verified

- **ChatGPT:** the exact menu path (Plugins vs Apps, where the Developer mode toggle lives) and which plans get full MCP apps.
- **Cursor:** whether deeplinks work in every current build (a forum report says the install card broke for a while in 2026); the `url`-only shape comes from Cursor's docs as quoted in search results and GitHub's own install button.
- **Windsurf / Devin Desktop:** the panel labels after the rename, and whether `url` works as well as `serverUrl`.
- **Warp, Perplexity, Le Chat, OpenCode:** steps come from third-party guides.
- **JetBrains:** the settings path, the **As JSON** option, and whether Junie can sign in with OAuth (reports disagree). AI Assistant has no MCP sign-in as of September 2026.
