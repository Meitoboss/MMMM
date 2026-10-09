import { sha256 } from './sha256';
import { concatBytes, utf8Encode } from './bytes';

/**
 * Random bytes. The phone's JavaScript engine has no secure random source by default, so:
 *  - when `crypto.getRandomValues` exists, it is used ("secure": true);
 *  - otherwise the bytes are mixed from time and Math.random ("secure": false) – fine for a SALT or a NONCE (they only have to
 *    differ from file to file, they are not secret), NEVER used to make a secret key.
 */
export interface RandomResult {
  bytes: Uint8Array;
  secure: boolean;
}

let counter = 0;

type Source = { getRandomValues?: (a: Uint8Array) => Uint8Array };

/** `source` null = "there is none" (what the phone has by default) */
export function randomBytes(n: number, source: Source | null = (globalThis as { crypto?: Source }).crypto ?? null): RandomResult {
  if (source && typeof source.getRandomValues === 'function') {
    const bytes = new Uint8Array(n);
    source.getRandomValues(bytes);
    return { bytes, secure: true };
  }
  const out = new Uint8Array(n);
  for (let o = 0; o < n; o += 32) {
    const seed = `${Date.now()}|${typeof performance !== 'undefined' ? performance.now() : 0}|${Math.random()}|${Math.random()}|${counter++}`;
    out.set(sha256(concatBytes(utf8Encode(seed), out.subarray(Math.max(0, o - 32), o))).subarray(0, Math.min(32, n - o)), o);
  }
  return { bytes: out, secure: false };
}

export const hasSecureRandom = (): boolean => typeof (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto?.getRandomValues === 'function';
