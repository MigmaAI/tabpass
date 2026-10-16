import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const ORIGIN = 'https://app.example';

class FakeWindow extends EventTarget {
  sent = [];
  messageListeners = 0;
  onPost = null;
  location = { origin: ORIGIN, protocol: 'https:' };

  get top() {
    return this;
  }

  addEventListener(type, listener, options) {
    if (type === 'message') this.messageListeners += 1;
    return super.addEventListener(type, listener, options);
  }

  removeEventListener(type, listener, options) {
    if (type === 'message') this.messageListeners -= 1;
    return super.removeEventListener(type, listener, options);
  }

  postMessage(data, targetOrigin) {
    this.sent.push({ data, targetOrigin });
    this.onPost?.(data, targetOrigin);
  }

  respond(data, { origin = ORIGIN, source = this } = {}) {
    const event = new Event('message');
    Object.defineProperties(event, {
      data: { value: data },
      origin: { value: origin },
      source: { value: source },
    });
    this.dispatchEvent(event);
  }
}

const fakeWindow = new FakeWindow();
Object.defineProperties(globalThis, {
  window: { configurable: true, value: fakeWindow },
  location: { configurable: true, value: { origin: ORIGIN } },
});

const sdk = await import('../dist/index.js');

function resetWindow() {
  assert.equal(fakeWindow.messageListeners, 0, 'the previous request leaked a message listener');
  fakeWindow.sent = [];
  fakeWindow.onPost = null;
}

function successFor(request, result, overrides = {}) {
  fakeWindow.respond(
    {
      tabpass: 'response',
      id: request.id,
      protocol: 1,
      result,
      ...overrides,
    },
    overrides.event,
  );
}

test.beforeEach(resetWindow);
test.after(() => {
  delete globalThis.window;
  delete globalThis.location;
});

test('hello posts the v1 request to the page origin and returns a validated result', async () => {
  fakeWindow.onPost = (request, targetOrigin) => {
    assert.equal(targetOrigin, ORIGIN);
    assert.deepEqual(request.params, {});
    assert.equal(request.method, 'hello');
    assert.equal(request.tabpass, 'request');
    successFor(request, { name: 'Tabpass', version: '0.3.0', protocol: 1, connected: false });
  };

  assert.deepEqual(await sdk.hello(), {
    name: 'Tabpass',
    version: '0.3.0',
    protocol: 1,
    connected: false,
  });
  assert.equal(fakeWindow.messageListeners, 0);
});

test('connect sends only public parameters and validates the credential response', async () => {
  const credential = `tp_abcdefghijklmnop.${'a'.repeat(43)}`;
  fakeWindow.onPost = (request) => {
    assert.deepEqual(request.params, { name: 'Acme AI', access: 'control' });
    successFor(request, {
      token: credential,
      mcpUrl: 'https://tabs.example/mcp',
      connectorUrl: `https://tabs.example/mcp/${credential}`,
      access: 'read',
      name: 'Acme AI',
    });
  };

  const result = await sdk.connect({ name: 'Acme AI', access: 'control' });
  assert.equal(result.access, 'read', 'the person may reduce the requested access');
  assert.equal(result.token, credential);
  assert.equal(fakeWindow.messageListeners, 0);
});

test('status and disconnect use their own methods and result shapes', async () => {
  fakeWindow.onPost = (request) => {
    if (request.method === 'status') {
      successFor(request, { connected: true, access: 'read', name: 'Acme AI' });
    } else {
      successFor(request, { disconnected: 1 });
    }
  };

  assert.deepEqual(await sdk.status(), { connected: true, access: 'read', name: 'Acme AI' });
  assert.deepEqual(await sdk.disconnect(), { disconnected: 1 });
  assert.equal(fakeWindow.messageListeners, 0);
});

test('ignores unrelated messages and responses from another sender, origin, or id', async () => {
  fakeWindow.onPost = (request) => {
    const result = { name: 'Tabpass', version: '0.3.0', protocol: 1, connected: true };
    successFor(request, result, { event: { source: {} } });
    successFor(request, result, { event: { origin: 'https://attacker.example' } });
    successFor({ ...request, id: 'another-request' }, result);
    fakeWindow.respond({ tabpass: 'something-else', id: request.id, protocol: 1, result });
    queueMicrotask(() => successFor(request, result));
  };

  assert.equal((await sdk.hello({ timeoutMs: 50 })).connected, true);
  assert.equal(fakeWindow.messageListeners, 0);
});

test('rejects a matching response with the wrong protocol version', async () => {
  fakeWindow.onPost = (request) => {
    successFor(request, { name: 'Tabpass', version: '0.3.0', protocol: 1, connected: true }, { protocol: 2 });
  };

  await assert.rejects(sdk.hello(), (error) => {
    assert.ok(error instanceof sdk.TabpassError);
    assert.equal(error.code, 'invalid_response');
    return true;
  });
  assert.equal(fakeWindow.messageListeners, 0);
});

test('rejects a matching malformed response and does not expose credential-like data', async () => {
  const secret = 'tp_browser.should-not-appear';
  fakeWindow.onPost = (request) => {
    successFor(request, { token: secret, mcpUrl: 42 });
  };

  await assert.rejects(
    sdk.connect({ name: 'Acme AI', access: 'read' }, { timeoutMs: 50 }),
    (error) => {
      assert.ok(error instanceof sdk.TabpassError);
      assert.equal(error.code, 'invalid_response');
      assert.doesNotMatch(error.message, /tp_browser|should-not-appear/);
      return true;
    },
  );
  assert.equal(fakeWindow.messageListeners, 0);
});

test('preserves a protocol error code while redacting an untrusted error message', async () => {
  const secret = 'tp_browser.should-not-appear';
  fakeWindow.onPost = (request) => {
    fakeWindow.respond({
      tabpass: 'response',
      id: request.id,
      protocol: 1,
      error: { code: 'declined', message: `Declined ${secret}` },
    });
  };

  await assert.rejects(sdk.connect({ name: 'Acme AI', access: 'read' }), (error) => {
    assert.ok(error instanceof sdk.TabpassError);
    assert.equal(error.code, 'declined');
    assert.doesNotMatch(error.message, /tp_browser|should-not-appear/);
    return true;
  });
  assert.equal(fakeWindow.messageListeners, 0);
});

test('times out and removes its listener', async () => {
  await assert.rejects(sdk.hello({ timeoutMs: 5 }), (error) => {
    assert.ok(error instanceof sdk.TabpassError);
    assert.equal(error.code, 'timeout');
    return true;
  });
  assert.equal(fakeWindow.messageListeners, 0);
});

test('aborts an active request and removes its listener', async () => {
  const controller = new AbortController();
  const pending = sdk.status({ signal: controller.signal, timeoutMs: 100 });
  assert.equal(fakeWindow.messageListeners, 1);
  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof sdk.TabpassError);
    assert.equal(error.code, 'aborted');
    return true;
  });
  assert.equal(fakeWindow.messageListeners, 0);
});

test('an already-aborted request does not send or install a listener', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(sdk.disconnect({ signal: controller.signal }), (error) => {
    assert.ok(error instanceof sdk.TabpassError);
    assert.equal(error.code, 'aborted');
    return true;
  });
  assert.equal(fakeWindow.sent.length, 0);
  assert.equal(fakeWindow.messageListeners, 0);
});

test('invalid parameters and timeout options fail before sending', async () => {
  await assert.rejects(sdk.connect({ name: '', access: 'read' }), (error) => {
    assert.ok(error instanceof sdk.TabpassError);
    assert.equal(error.code, 'invalid_request');
    return true;
  });
  await assert.rejects(sdk.hello({ timeoutMs: 0 }), (error) => {
    assert.ok(error instanceof sdk.TabpassError);
    assert.equal(error.code, 'invalid_request');
    return true;
  });
  await assert.rejects(sdk.status({ timeoutMs: 180001 }), (error) => {
    assert.ok(error instanceof sdk.TabpassError);
    assert.equal(error.code, 'invalid_request');
    return true;
  });
  assert.equal(fakeWindow.sent.length, 0);
  assert.equal(fakeWindow.messageListeners, 0);
});

test('the ESM module imports during SSR and rejects only when a browser API is called', () => {
  const moduleUrl = pathToFileURL(new URL('../dist/index.js', import.meta.url).pathname).href;
  const script = `
    const sdk = await import(${JSON.stringify(moduleUrl)});
    try {
      await sdk.hello();
      process.exit(2);
    } catch (error) {
      if (!(error instanceof sdk.TabpassError) || error.code !== 'unavailable') process.exit(3);
    }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
