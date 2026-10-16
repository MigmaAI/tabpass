// Token scheme shared with relay/src/tokens.ts. Keep both sides in sync.
//   browserKey  32 random bytes, base64url (43 chars). Proves this browser to the relay.
//   browserId   first 16 chars of base64url(sha256(browserKey)).
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

export async function browserIdFromKey(browserKey) {
  return base64url(await sha256(browserKey)).slice(0, 16);
}

export async function createAgentToken(browserKey) {
  const secret = randomKey();
  const browserId = await browserIdFromKey(browserKey);
  return { token: `${TOKEN_PREFIX}${browserId}.${secret}`, tokenHash: await sha256Hex(secret) };
}
