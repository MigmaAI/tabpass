// Token scheme shared with relay/src/tokens.ts. Keep both sides in sync.
//   browserKey  32 random bytes, base64url (43 chars). Never leaves this browser.
//   relay key   HMAC-SHA256(browserKey, relay origin), base64url. Proves this browser to ONE relay,
//               so a relay (any https site can ask to be one) cannot pose as this browser on another.
//   browserId   first 16 chars of base64url(sha256(relay key)).
//   agent token tp_<browserId>.<secret>; the relay only ever receives sha256(secret) from us.

export const TOKEN_PREFIX = 'tp_';

export function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomKey() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function sha256Hex(text) {
  return [...(await sha256(text))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The key this browser shows to the relay at `relayUrl`. Same relay origin, same key. */
export async function relayKey(browserKey, relayUrl) {
  const url = new URL(relayUrl);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(browserKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`tabpass relay key v1 ${url.protocol}//${url.host}`));
  return base64url(new Uint8Array(mac));
}

export async function browserIdFromKey(browserKey) {
  return base64url(await sha256(browserKey)).slice(0, 16);
}

/** `key` is the relay key of the relay the agent will use (see relayKey). */
export async function createAgentToken(key) {
  const secret = randomKey();
  const browserId = await browserIdFromKey(key);
  return { token: `${TOKEN_PREFIX}${browserId}.${secret}`, tokenHash: await sha256Hex(secret) };
}
