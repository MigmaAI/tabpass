// Web Crypto helpers that run the same in Node 20+ and Cloudflare Workers.

// Derived from the runtime so this file compiles against Node's and Workers' types alike.
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return [...(await sha256(data))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings without leaking where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = utf8(a);
  const right = utf8(b);
  let diff = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

/**
 * Signs and seals small JSON payloads with keys derived from one relay secret (HKDF-SHA256), so the
 * relay can issue OAuth client ids, request tickets and authorization codes without a database.
 */
export class Sealer {
  private constructor(
    private readonly signKey: Key,
    private readonly sealKey: Key
  ) {}

  static async fromSecret(secret: string): Promise<Sealer> {
    if (secret.length < 32) throw new Error('The relay secret must be at least 32 characters.');
    const base = await crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, ['deriveKey']);
    const hkdf = (info: string): { name: string; hash: string; salt: Uint8Array; info: Uint8Array } => ({
      name: 'HKDF',
      hash: 'SHA-256',
      salt: utf8('tabpass-relay'),
      info: utf8(info),
    });
    const signKey = await crypto.subtle.deriveKey(hkdf('sign'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
    const sealKey = await crypto.subtle.deriveKey(hkdf('seal'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return new Sealer(signKey, sealKey);
  }

  /** Readable but tamper-proof: `<payload>.<signature>`. */
  async sign(value: unknown): Promise<string> {
    const payload = base64url(utf8(JSON.stringify(value)));
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', this.signKey, utf8(payload)));
    return `${payload}.${base64url(signature)}`;
  }

  async verify<T>(token: string): Promise<T | null> {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const signatureBytes = fromBase64url(signature);
    const payloadBytes = fromBase64url(payload);
    if (!signatureBytes || !payloadBytes) return null;
    const valid = await crypto.subtle.verify('HMAC', this.signKey, signatureBytes, utf8(payload));
    if (!valid) return null;
    try {
      return JSON.parse(decoder.decode(payloadBytes)) as T;
    } catch {
      return null;
    }
  }

  /** Encrypted and authenticated: only this relay can read or make it. */
  async seal(value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.sealKey, utf8(JSON.stringify(value)))
    );
    const out = new Uint8Array(iv.length + ciphertext.length);
    out.set(iv);
    out.set(ciphertext, iv.length);
    return base64url(out);
  }

  async open<T>(token: string): Promise<T | null> {
    const bytes = fromBase64url(token);
    if (!bytes || bytes.length < 13) return null;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, this.sealKey, bytes.slice(12));
      return JSON.parse(decoder.decode(plain)) as T;
    } catch {
      return null;
    }
  }
}
