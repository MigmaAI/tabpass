/** Tabpass Web Protocol v1. No network requests, storage, or automatic retries. */
export type Access = 'read' | 'control';
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface ConnectParams { name: string; access: Access }
export interface Connection { token: string; mcpUrl: string; connectorUrl: string; access: Access; name: string }
export interface Hello { name: 'Tabpass'; version: string; protocol: 1; connected: boolean }
export interface Status { connected: boolean; access: Access | null; name: string | null }

const messages: Record<string, string> = {
  timeout: 'Tabpass did not answer in time.',
  aborted: 'The request was cancelled.',
  unavailable: 'Tabpass requires a top-level HTTP or HTTPS browser page.',
  invalid_request: 'Invalid Tabpass request options.',
  invalid_response: 'Tabpass returned an invalid response.',
  declined: 'The connection was not approved.',
  busy: 'A Tabpass connection request is already open.',
  activation_required: 'Connect from a button click.',
  relay_unavailable: 'Tabpass could not connect to its relay. Try again when it is online.',
  invalid: 'Tabpass could not accept this request.',
  unknown_method: 'This Tabpass version does not support the request.',
};

export class TabpassError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(messages[code] ?? 'Tabpass could not complete the request.');
    this.name = 'TabpassError';
    this.code = code;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const access = (value: unknown): value is Access => value === 'read' || value === 'control';
const name = (value: unknown): value is string => typeof value === 'string' && /^[^\u0000-\u001f\u007f]{1,255}$/.test(value);
const token = (value: unknown): value is string => typeof value === 'string' && /^tp_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/.test(value);

function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && !url.search &&
      (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
}

function request<T>(method: string, params: object, defaults: number, options: RequestOptions,
  validate: (value: unknown) => value is T): Promise<T> {
  return new Promise((resolve, reject) => {
    const fail = (code: string) => reject(new TabpassError(code));
    if (!options || typeof options !== 'object' || Array.isArray(options) || (options.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 180_000)) ||
      (options.signal !== undefined && (!options.signal || typeof options.signal.addEventListener !== 'function' ||
        typeof options.signal.removeEventListener !== 'function' || typeof options.signal.aborted !== 'boolean'))) {
      fail('invalid_request'); return;
    }
    if (options.signal?.aborted) { fail('aborted'); return; }
    if (typeof window === 'undefined' || window.top !== window ||
      !/^https?:$/.test(window.location.protocol) || window.location.origin === 'null' ||
      !globalThis.crypto?.randomUUID) { fail('unavailable'); return; }
    const target = window;
    const origin = target.location.origin;
    const id = globalThis.crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener('message', receive);
      options.signal?.removeEventListener('abort', abort);
    };
    const finishError = (code: string) => { cleanup(); fail(code); };
    const abort = () => finishError('aborted');
    const receive = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (event.source !== target || event.origin !== origin || !record(data) ||
        data.tabpass !== 'response' || data.id !== id) return;
      if (data.protocol !== 1) { finishError('invalid_response'); return; }
      if ('error' in data) {
        if ('result' in data || !record(data.error) || typeof data.error.code !== 'string' ||
          !/^[a-z][a-z0-9_]{0,63}$/.test(data.error.code)) { finishError('invalid_response'); return; }
        finishError(data.error.code); return;
      }
      if (!validate(data.result)) { finishError('invalid_response'); return; }
      cleanup(); resolve(data.result);
    };
    target.addEventListener('message', receive);
    options.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finishError('timeout'), options.timeoutMs ?? defaults);
    try { target.postMessage({ tabpass: 'request', id, method, params }, origin); }
    catch { finishError('unavailable'); }
  });
}

/** Call directly from a user click. Send the returned credential to your authenticated backend. */
export function connect(params: ConnectParams, options: RequestOptions = {}): Promise<Connection> {
  if (!record(params) || typeof params.name !== 'string' ||
    !/^[^\u0000-\u001f\u007f]{1,40}$/.test(params.name.trim()) || !access(params.access)) {
    return Promise.reject(new TabpassError('invalid_request'));
  }
  return request('connect', { name: params.name.trim(), access: params.access }, 130_000, options,
    (v): v is Connection => record(v) && token(v.token) &&
      validEndpoint(v.mcpUrl) && v.connectorUrl === `${v.mcpUrl}/${v.token}` && access(v.access) && name(v.name));
}

/** Unknown sites need a recent user click to receive any response. */
export function hello(options: RequestOptions = {}): Promise<Hello> {
  return request('hello', {}, 1500, options, (v): v is Hello => record(v) && v.name === 'Tabpass' &&
    typeof v.version === 'string' && v.version.length > 0 && v.version.length <= 100 &&
    v.protocol === 1 && typeof v.connected === 'boolean');
}

/** Reports a saved grant, not live relay availability. */
export function status(options: RequestOptions = {}): Promise<Status> {
  return request('status', {}, 1500, options, (v): v is Status => record(v) &&
    (v.connected === true && access(v.access) && name(v.name) ||
      v.connected === false && v.access === null && v.name === null));
}

/** Removes this site's grants in the current browser, not credentials saved by your backend. */
export function disconnect(options: RequestOptions = {}): Promise<{ disconnected: number }> {
  return request('disconnect', {}, 10_000, options, (v): v is { disconnected: number } => record(v) &&
    Number.isSafeInteger(v.disconnected) && (v.disconnected as number) >= 0);
}
