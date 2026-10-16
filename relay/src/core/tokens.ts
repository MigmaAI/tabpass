import { base64url, constantTimeEqual, sha256, sha256Hex } from './crypto.js';

/**
 * Token scheme (no database on the relay):
 *
 *   browserKey  32 random bytes, base64url. Never leaves the extension except in the `hello` frame.
 *   browserId   first 16 chars of base64url(sha256(browserKey)). Only the holder of the key can
 *               register as that browser, so a stolen agent token cannot be used to impersonate it.
 *   agent token `tp_<browserId>.<secret>`. The extension registers sha256(secret) for each agent;
 *               the relay routes by browserId and checks the hash against that live connection.
 */

export const TOKEN_PREFIX = 'tp_';
const BROWSER_ID_LENGTH = 16;
const TOKEN_PATTERN = /^tp_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
export const BROWSER_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

export async function browserIdFromKey(browserKey: string): Promise<string> {
  return base64url(await sha256(browserKey)).slice(0, BROWSER_ID_LENGTH);
}

export function hashSecret(secret: string): Promise<string> {
  return sha256Hex(secret);
}

export interface ParsedAgentToken {
  browserId: string;
  tokenHash: string;
}

export async function parseAgentToken(token: string): Promise<ParsedAgentToken | null> {
  const match = TOKEN_PATTERN.exec(token.trim());
  if (!match || !match[1] || !match[2]) return null;
  return { browserId: match[1], tokenHash: await hashSecret(match[2]) };
}

export function hashesEqual(a: string, b: string): boolean {
  return constantTimeEqual(a, b);
}

/** Keeps tokens out of logs: `tp_AbCd…` */
export function redactToken(value: string): string {
  return value.replace(/tp_[A-Za-z0-9_-]{4}[A-Za-z0-9_.-]*/g, (token) => `${token.slice(0, 7)}…`);
}
