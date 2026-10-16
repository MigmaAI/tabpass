# Tabpass Web Protocol v1

A website can ask Tabpass to connect it as an AI tool, so its AI can use the person's open tabs. The person clicks a button on the site, Tabpass opens its own window, the person picks "Read" or "Read and act" and clicks Connect. The site gets an MCP token. No copying, no settings.

The protocol is small on purpose: four methods over `window.postMessage`, nothing on the network. Code: [`extension/public/content/bridge.js`](../extension/public/content/bridge.js) (page side) and [`extension/public/lib/web-connect.js`](../extension/public/lib/web-connect.js) (extension side). A working page: [`e2e/fixtures/ai-site.html`](../e2e/fixtures/ai-site.html).

Website authors can use the zero-dependency [`@migma/tabpass-connect` browser SDK](../connect/README.md) instead of implementing these messages directly. Install it with `npm install @migma/tabpass-connect`.

## Messages

The page posts a request to its own window, and Tabpass posts the response back to the same window.

```js
// page -> Tabpass
window.postMessage({ tabpass: 'request', id, method, params }, location.origin);

// Tabpass -> page
{ tabpass: 'response', id, protocol: 1, result }        // success
{ tabpass: 'response', id, protocol: 1, error: { code, message } }
```

- `id` is a string up to 100 characters. Use a fresh one per request (`crypto.randomUUID()`).
- `params` is an object. Unknown fields are ignored.
- Only the top frame of a tab is answered, and only on `http:` and `https:` pages. Frames, `file:` pages and sandboxed (`null` origin) documents get no answer.
- The origin Tabpass acts on comes from Chrome (`sender.origin`), never from the message.

## When Tabpass answers

Tabpass stays silent unless one of these is true:

1. **The request follows a click.** The page has [transient user activation](https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation), which lasts about 5 seconds after a click or key press.
2. **Tabpass already knows the site:**
   - it is a relay this browser uses;
   - it is an account provider built into Tabpass (Migma);
   - or it connected an AI tool through this protocol before.

Without either, the request gets no answer at all, not even an error. A site cannot tell, without the person's click, whether Tabpass is installed. This keeps Tabpass from becoming one more way to fingerprint people.

So a page should not wait on a silent probe. Show a "Connect your browser" button, and do the work in its click handler.

## Methods

### `hello`

Is Tabpass here?

```js
→ {}
← { name: 'Tabpass', version: '0.3.0', protocol: 1, connected: false }
```

`connected` is true when this site has an AI tool connected in this browser.

### `status`

Is this site connected, and how?

```js
→ {}
← { connected: true, access: 'read', name: 'Acme AI' }
```

`access` and `name` are `null` when not connected.

### `connect`

Asks the person to connect this site. Only works right after a click: otherwise a known site gets `activation_required` and an unknown site gets no answer.

```js
→ { name: 'Acme AI', access: 'read' }
← { token: 'tp_…', mcpUrl: 'https://tabs.migma.ai/mcp', connectorUrl: 'https://tabs.migma.ai/mcp/tp_…', access: 'read', name: 'Acme AI' }
```

| Param | Type | Meaning |
|---|---|---|
| `name` | string, 1–40 characters | What the person sees in Tabpass. Defaults to the site's host. |
| `access` | `'read'` or `'control'` | What the site asks for. The person can change it in the window; the answer's `access` is what they chose. |
| `relay` | `true` | Only for relays (see below). |
| `returnsTo` | string, up to 80 characters | Only for relays: where the sign-in goes back to, shown in the window. |

Tabpass opens its window ("Connect Acme AI to your browser?") and answers once the person decides, or after 2 minutes. Keep the request open that long. A successful response provides the credential, but the website's backend must initialize its MCP connection and verify the credential before the product reports Connected.

If the site connected before with the same name, the new connection replaces the old one.

### `disconnect`

Removes every AI tool this site connected in this browser. Their tokens stop working at once.

```js
→ {}
← { disconnected: 1 }
```

## Errors

| `code` | When |
|---|---|
| `declined` | The person clicked "Don't connect" or closed the window. |
| `timeout` | Nobody answered within 2 minutes. |
| `busy` | Tabpass is already asking the person about this site. |
| `activation_required` | `connect` without a click, from a site Tabpass knows. |
| `relay_unavailable` | Tabpass could not establish the relay connection for the new tool. The visible grant may still exist in Tabpass and can be removed there or with `disconnect`; the website must not report Connected. |
| `invalid` | `relay: true` from a page that is not https (or `http://localhost`, `http://127.0.0.1`). |
| `unknown_method` | The method does not exist. |

No answer at all means one of three things: Tabpass is not installed, it is an older version, or the site is unknown and there was no click.

## Using the token

The token works with any MCP client, over Streamable HTTP:

- `mcpUrl` with the header `Authorization: Bearer <token>`. Prefer this.
- `connectorUrl`, which carries the token in the path, for clients that only take a URL.

It reaches this browser through the relay the person set in Tabpass (by default Migma's, `tabs.migma.ai`). With "Read" the tool can list tabs, read pages and highlighted text, take screenshots and read a page's design. With "Read and act" it can also open tabs, click, type, press keys and scroll. Either way, Tabpass asks the person before the tool uses each new site.

Send the token to your server and keep it there. Do not leave it in the page: any script running on the page can read it.

Every participating website needs its own authenticated backend and MCP client. The backend allowlists the expected Tabpass endpoint, stores the token, calls `mcpUrl` with `Authorization: Bearer <token>`, and verifies the MCP connection before returning a connected state to the page. Never fetch an arbitrary page-provided `mcpUrl`: any script on the page can forge a same-origin `postMessage` response. Adding the browser SDK does not automatically enable ChatGPT, Claude, or another AI product.

The page should POST the result to its authenticated same-site backend immediately, then drop its reference. Never put the token in `localStorage`, session storage, analytics, logs, or a URL. `connectorUrl` exists for MCP clients that can only accept a URL; do not use it as a browser navigation target because it contains the credential.

## Relays use it too

A Tabpass relay's own sign-in page (MCP OAuth, `/authorize`) is a site that speaks this protocol. It calls `connect` with `relay: true`: the new tool then lives on the relay that served the page, and the token goes back to the AI tool that is signing in. The `returnsTo` text ("chatgpt.com", "an app on this computer") tells the person where it goes.

With `relay: true`, Tabpass connects to `wss://<the page's host>/extension`. Each relay gets a key made for that relay alone (an HMAC of this browser's key and the relay's origin). A site that names itself as a relay learns nothing it could use to pose as this browser on another relay.

## Browser SDK example

The SDK exposes `connect`, `hello`, `status`, `disconnect`, and `TabpassError`. `connect` accepts only the public website parameters `name` and `access`; relay-only parameters are intentionally unavailable. It does not retry, store credentials, make network requests, or navigate to an install page.

```ts
import { connect, TabpassError } from '@migma/tabpass-connect';

document.querySelector('#connect')?.addEventListener('click', async () => {
  try {
    let { token, mcpUrl, access, name } = await connect({ name: 'Acme AI', access: 'read' });
    const response = await fetch('/api/tabpass/connections', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        mcpUrl,
        access,
        name,
      }),
    });
    if (!response.ok) throw new Error('Your browser connection could not be verified.');
    token = '';
  } catch (error) {
    if (error instanceof TabpassError && error.code === 'declined') return;
    console.warn(error instanceof Error ? error.message : 'Tabpass connection failed');
  }
});
```

Call `connect` directly from the click handler. A preliminary `hello` probe is optional, but the site must not wait or navigate automatically when Tabpass stays silent.

An SDK abort or timeout stops only the page's wait. It cannot close Tabpass's approval window or cancel a grant approved afterward. Recheck `status` before retrying; call `disconnect` when the person asks to remove the site's grants.

## Security

- **The person decides.** A page can never connect itself, and it can never open Tabpass's window without the person's click. One window per site at a time.
- **Site approvals still apply.** A tool connected this way asks before using each new site, like any other.
- **Visible and revocable.** The tool shows in the side panel with the site it came from, and can be removed there, or by the site with `disconnect`.
- **Same-window only.** Tabpass ignores messages from other windows and frames, and answers only to the page's own origin.
- **No data in the page.** Apart from the token after a `connect`, nothing about tabs or pages ever goes back to the page. Page data travels only to the MCP client holding the token, through the relay.

## Versioning

Every answer carries `protocol: 1`. New methods and new optional fields keep version 1. A change that breaks existing pages would be version 2, and Tabpass would keep answering version 1 pages.
