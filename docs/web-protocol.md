# Tabpass Web Protocol v1

A website can ask Tabpass to connect it as an AI tool, so its AI can use the person's open tabs. The person clicks a button on the site, Tabpass opens its own window, the person picks "Read" or "Read and act" and clicks Connect. The site gets an MCP token. No copying, no settings.

The protocol is small on purpose: four methods over `window.postMessage`, nothing on the network. Code: [`extension/public/content/bridge.js`](../extension/public/content/bridge.js) (page side) and [`extension/public/lib/web-connect.js`](../extension/public/lib/web-connect.js) (extension side). A working page: [`e2e/fixtures/ai-site.html`](../e2e/fixtures/ai-site.html).

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

Tabpass opens its window ("Connect Acme AI to your browser?") and answers once the person decides, or after 2 minutes. Keep the request open that long. The answer comes after Tabpass's relay has the new tool, so the token works at once.

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
| `invalid` | `relay: true` from a page that is not https (or `http://localhost`, `http://127.0.0.1`). |
| `unknown_method` | The method does not exist. |

No answer at all means one of three things: Tabpass is not installed, it is an older version, or the site is unknown and there was no click.

## Using the token

The token works with any MCP client, over Streamable HTTP:

- `mcpUrl` with the header `Authorization: Bearer <token>`. Prefer this.
- `connectorUrl`, which carries the token in the path, for clients that only take a URL.

It reaches this browser through the relay the person set in Tabpass (by default Migma's, `tabs.migma.ai`). With "Read" the tool can list tabs, read pages and highlighted text, take screenshots and read a page's design. With "Read and act" it can also open tabs, click, type, press keys and scroll. Either way, Tabpass asks the person before the tool uses each new site.

Send the token to your server and keep it there. Do not leave it in the page: any script running on the page can read it.

## Relays use it too

A Tabpass relay's own sign-in page (MCP OAuth, `/authorize`) is a site that speaks this protocol. It calls `connect` with `relay: true`: the new tool then lives on the relay that served the page, and the token goes back to the AI tool that is signing in. The `returnsTo` text ("chatgpt.com", "an app on this computer") tells the person where it goes.

With `relay: true`, Tabpass connects to `wss://<the page's host>/extension`. Each relay gets a key made for that relay alone (an HMAC of this browser's key and the relay's origin). A site that names itself as a relay learns nothing it could use to pose as this browser on another relay.

## A complete example

```html
<button id="connect">Connect your browser</button>
<script>
  function ask(method, params = {}, timeoutMs = 130000) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => done(() => reject(Object.assign(new Error('Tabpass did not answer'), { code: 'no_answer' }))), timeoutMs);
      function done(settle) {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        settle();
      }
      function onMessage(event) {
        const data = event.data;
        if (event.source !== window || event.origin !== location.origin || data?.tabpass !== 'response' || data.id !== id) return;
        done(() => (data.error ? reject(Object.assign(new Error(data.error.message), { code: data.error.code })) : resolve(data.result)));
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ tabpass: 'request', id, method, params }, location.origin);
    });
  }

  document.getElementById('connect').addEventListener('click', async () => {
    try {
      await ask('hello', {}, 1500); // answers at once if Tabpass is installed
    } catch {
      location.href = 'https://chromewebstore.google.com/detail/tabpass'; // your install link
      return;
    }
    try {
      const { token, mcpUrl, access } = await ask('connect', { name: 'Acme AI', access: 'read' });
      await fetch('/api/tabpass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, mcpUrl, access }) });
    } catch (error) {
      if (error.code !== 'declined') console.warn(error.message);
    }
  });
</script>
```

`connect` still has the click: `hello` takes a few milliseconds, well inside the 5 seconds of activation.

## Security

- **The person decides.** A page can never connect itself, and it can never open Tabpass's window without the person's click. One window per site at a time.
- **Site approvals still apply.** A tool connected this way asks before using each new site, like any other.
- **Visible and revocable.** The tool shows in the side panel with the site it came from, and can be removed there, or by the site with `disconnect`.
- **Same-window only.** Tabpass ignores messages from other windows and frames, and answers only to the page's own origin.
- **No data in the page.** Apart from the token after a `connect`, nothing about tabs or pages ever goes back to the page. Page data travels only to the MCP client holding the token, through the relay.

## Versioning

Every answer carries `protocol: 1`. New methods and new optional fields keep version 1. A change that breaks existing pages would be version 2, and Tabpass would keep answering version 1 pages.
