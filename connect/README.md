# `@migma/tabpass-connect`

Zero-dependency TypeScript SDK for connecting a website's authenticated backend to the visitor's Tabpass browser over MCP.

Browser SDK for the [Tabpass Web Protocol](https://github.com/MigmaAI/tabpass/blob/main/docs/web-protocol.md).

```bash
npm install @migma/tabpass-connect
```

## Use it from a click

`connect()` must run directly from a click or key handler. Tabpass asks the person to approve the connection in its own window and returns a short-lived page copy of the MCP credential.

```ts
import { connect, TabpassError } from '@migma/tabpass-connect';

button.addEventListener('click', async () => {
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

    // Do not retain the token in browser state after the authenticated handoff.
    token = '';
  } catch (error) {
    if (error instanceof TabpassError && error.code === 'declined') return;
    console.error(error instanceof Error ? error.message : 'Tabpass connection failed');
  }
});
```

Your backend must allowlist the expected Tabpass MCP endpoint, store the credential securely, initialize its MCP connection, and verify that the credential works before the product reports Connected. Never let a page-provided `mcpUrl` become an unrestricted server-side request target. Any script on the page can send same-origin `postMessage` responses, so the backend remains the trust boundary. Adding the SDK to a page does not automatically enable ChatGPT, Claude, or another AI product.

Do not put the token in `localStorage`, session storage, analytics, logs, or a URL. Do not send it to a third party from the page. POST it immediately to an authenticated same-site backend endpoint, then drop the page's reference.

## API

```ts
connect(
  { name: string, access: 'read' | 'control' },
  { signal?: AbortSignal, timeoutMs?: number } = {},
): Promise<{
  token: string;
  mcpUrl: string;
  connectorUrl: string;
  access: 'read' | 'control';
  name: string;
}>;

hello({ signal?: AbortSignal, timeoutMs?: number } = {}): Promise<{
  name: string;
  version: string;
  protocol: 1;
  connected: boolean;
}>;

status({ signal?: AbortSignal, timeoutMs?: number } = {}): Promise<{
  connected: boolean;
  access: 'read' | 'control' | null;
  name: string | null;
}>;

disconnect({ signal?: AbortSignal, timeoutMs?: number } = {}): Promise<{
  disconnected: number;
}>;
```

The default timeout is 130 seconds for `connect`, 1.5 seconds for `hello` and `status`, and 10 seconds for `disconnect`. There is no automatic retry, storage, network request, install redirect, or navigation. `relay: true` is reserved for relay authorization pages and is intentionally absent from this SDK.

Aborting or timing out an SDK call stops the page from waiting. It cannot cancel a Tabpass approval window or revoke a grant the person may approve afterward. Recheck status before retrying, and use `disconnect()` when the person asks to remove this site's Tabpass grants.

`TabpassError` extends `Error` and exposes a stable `code`. Protocol errors such as `declined`, `busy`, and `activation_required` are preserved. Local codes are `timeout`, `aborted`, `unavailable` (no supported browser window), `invalid_request`, and `invalid_response`. Error messages never include response or credential data. Treat messages as display text rather than control-flow identifiers; branch on `code`.

See the [Web Protocol specification](https://github.com/MigmaAI/tabpass/blob/main/docs/web-protocol.md) for activation, privacy, and security details.
