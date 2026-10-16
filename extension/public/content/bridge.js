// Tabpass Web Protocol v1, page side. Runs in every top frame (isolated world) and answers pages
// that ask through window.postMessage:
//
//   page  -> window.postMessage({ tabpass: 'request', id, method, params }, location.origin)
//   page <-  window.postMessage({ tabpass: 'response', id, protocol: 1, result | error }, location.origin)
//
// Methods: hello, status, connect, disconnect. Spec: docs/web-protocol.md.
// Sites the person has not used Tabpass with get NO answer unless the request comes right after a
// click, so Tabpass cannot be detected (fingerprinted) silently.

(() => {
  if (window.top !== window || globalThis.__tabpassBridge) return;
  globalThis.__tabpassBridge = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.tabpass !== 'request' || typeof data.id !== 'string' || typeof data.method !== 'string') return;
    if (data.id.length > 100) return;

    const activated = navigator.userActivation?.isActive === true;
    chrome.runtime
      .sendMessage({ type: 'web', method: data.method, params: data.params ?? {}, activated })
      .then((response) => {
        if (!response || response.silent) return;
        window.postMessage(
          { tabpass: 'response', id: data.id, protocol: 1, ...(response.ok ? { result: response.result } : { error: response.error }) },
          location.origin
        );
      })
      .catch(() => undefined); // Extension reloaded or updating: stay quiet.
  });
})();
