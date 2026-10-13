import { concatBytes } from './bytes';

/**
 * SHA-256, HMAC-SHA-256 and PBKDF2-HMAC-SHA-256 in plain JavaScript (the phone's JavaScript engine has no crypto library).
 * Checked against Node's own implementation in tests/crypto.test.ts.
 */
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** one block: w[0..15] are the 16 big-endian words of the block (w has room for 64; it is used as scratch) */
function compress(h: Int32Array, w: Int32Array): void {
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15];
    const b = w[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
}

export class Sha256 {
  private h = Int32Array.from(IV);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private total = 0;
  private w = new Int32Array(64);

  /** continues from a saved state (used by HMAC, which hashes a fixed first block once) */
  static fromState(state: Int32Array, bytesSoFar: number): Sha256 {
    const s = new Sha256();
    s.h.set(state);
    s.total = bytesSoFar;
    return s;
  }

  private block(b: Uint8Array, o: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++, o += 4) w[i] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    compress(this.h, w);
  }

  update(data: Uint8Array): this {
    this.total += data.length;
    let o = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      o = take;
      if (this.bufLen === 64) {
        this.block(this.buf, 0);
        this.bufLen = 0;
      }
    }
    for (; o + 64 <= data.length; o += 64) this.block(data, o);
    if (o < data.length) {
      this.buf.set(data.subarray(o), 0);
      this.bufLen = data.length - o;
    }
    return this;
  }

  digest(): Uint8Array {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.bufLen < 56 ? 56 : 120) - this.bufLen) + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits >>> 0;
    const n = pad.length;
    pad[n - 8] = (hi >>> 24) & 255; pad[n - 7] = (hi >>> 16) & 255; pad[n - 6] = (hi >>> 8) & 255; pad[n - 5] = hi & 255;
    pad[n - 4] = (lo >>> 24) & 255; pad[n - 3] = (lo >>> 16) & 255; pad[n - 2] = (lo >>> 8) & 255; pad[n - 1] = lo & 255;
    const keep = this.total;
    this.update(pad);
    this.total = keep;
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = (this.h[i] >>> 24) & 255; out[i * 4 + 1] = (this.h[i] >>> 16) & 255; out[i * 4 + 2] = (this.h[i] >>> 8) & 255; out[i * 4 + 3] = this.h[i] & 255;
    }
    return out;
  }
}

export const sha256 = (data: Uint8Array): Uint8Array => new Sha256().update(data).digest();

function hmacStates(key: Uint8Array): { inner: Int32Array; outer: Int32Array } {
  const k = key.length > 64 ? sha256(key) : key;
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const v = i < k.length ? k[i] : 0;
    ipad[i] = v ^ 0x36;
    opad[i] = v ^ 0x5c;
  }
  const state = (block: Uint8Array) => {
    const h = Int32Array.from(IV);
    const w = new Int32Array(64);
    for (let i = 0, o = 0; i < 16; i++, o += 4) w[i] = (block[o] << 24) | (block[o + 1] << 16) | (block[o + 2] << 8) | block[o + 3];
    compress(h, w);
    return h;
  };
  return { inner: state(ipad), outer: state(opad) };
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const { inner, outer } = hmacStates(key);
  const ih = Sha256.fromState(inner, 64).update(data).digest();
  return Sha256.fromState(outer, 64).update(ih).digest();
}

export interface Pbkdf2Options {
  /** 0 … 1, a few times a second while it works */
  onProgress?: (fraction: number) => void;
  /** polled between slices: throws "cancelled" */
  isCancelled?: () => boolean;
  /** iterations between two pauses (the pause keeps the screen alive) */
  sliceIterations?: number;
}

const pause = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * PBKDF2-HMAC-SHA-256: a key from a pass phrase, deliberately slow. Works in slices with a pause in between (so the app stays
 * responsive and can show progress). Each iteration costs two compressions.
 */
export async function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, dkLen: number, opts: Pbkdf2Options = {}): Promise<Uint8Array> {
  if (!(iterations >= 1) || !Number.isInteger(iterations)) throw new Error('iterations');
  const { inner, outer } = hmacStates(password);
  const blocks = Math.ceil(dkLen / 32);
  const out = new Uint8Array(blocks * 32);
  const w = new Int32Array(64);
  const st = new Int32Array(8);
  const u = new Int32Array(8);
  const t = new Int32Array(8);
  const slice = opts.sliceIterations ?? 4000;
  const totalWork = blocks * iterations;
  for (let bi = 1; bi <= blocks; bi++) {
    const idx = Uint8Array.of((bi >>> 24) & 255, (bi >>> 16) & 255, (bi >>> 8) & 255, bi & 255);
    const first = Sha256.fromState(outer, 64).update(Sha256.fromState(inner, 64).update(concatBytes(salt, idx)).digest()).digest();
    for (let i = 0; i < 8; i++) u[i] = (first[i * 4] << 24) | (first[i * 4 + 1] << 16) | (first[i * 4 + 2] << 8) | first[i * 4 + 3];
    t.set(u);
    for (let j = 1; j < iterations; j++) {
      for (let i = 0; i < 8; i++) w[i] = u[i];
      w[8] = 0x80000000 | 0; w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0; w[15] = 768; // 64 + 32 bytes
      st.set(inner);
      compress(st, w);
      for (let i = 0; i < 8; i++) w[i] = st[i];
      w[8] = 0x80000000 | 0; w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0; w[15] = 768;
      st.set(outer);
      compress(st, w);
      for (let i = 0; i < 8; i++) {
        u[i] = st[i];
        t[i] ^= st[i];
      }
      if (j % slice === 0) {
        opts.onProgress?.(((bi - 1) * iterations + j) / totalWork);
        if (opts.isCancelled?.()) throw new Error('cancelled');
        await pause();
      }
    }
    for (let i = 0; i < 8; i++) {
      out[(bi - 1) * 32 + i * 4] = (t[i] >>> 24) & 255; out[(bi - 1) * 32 + i * 4 + 1] = (t[i] >>> 16) & 255;
      out[(bi - 1) * 32 + i * 4 + 2] = (t[i] >>> 8) & 255; out[(bi - 1) * 32 + i * 4 + 3] = t[i] & 255;
    }
  }
  opts.onProgress?.(1);
  return out.slice(0, dkLen);
}
