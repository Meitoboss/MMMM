import { concatBytes, constantTimeEqual } from './bytes';

/**
 * ChaCha20-Poly1305 (RFC 8439) in plain JavaScript: encrypts and, with a tag, notices any change to the data.
 * Checked against Node's own implementation in tests/crypto.test.ts (many lengths, random data, tampering).
 */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
let fastPath = true;
/** tests only: forces the byte-by-byte path */
export const __setFastPath = (on: boolean): void => {
  fastPath = on;
};

const le32 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

/** XORs `data` with the ChaCha20 keystream (key 32 bytes, nonce 12 bytes, block counter start). `out` may be `data` itself. */
export function chacha20Xor(key: Uint8Array, nonce: Uint8Array, counter: number, data: Uint8Array, out: Uint8Array = new Uint8Array(data.length)): Uint8Array {
  if (key.length !== 32 || nonce.length !== 12) throw new Error('key must be 32 bytes and nonce 12 bytes');
  // RFC 8439: the block counter has 32 bits and must not wrap around (it would repeat the keystream)
  if (!(counter >= 0) || counter + Math.ceil(data.length / 64) > 0x100000000) throw new Error('block counter would overflow');
  const s0 = 0x61707865, s1 = 0x3320646e, s2 = 0x79622d32, s3 = 0x6b206574;
  const k0 = le32(key, 0), k1 = le32(key, 4), k2 = le32(key, 8), k3 = le32(key, 12), k4 = le32(key, 16), k5 = le32(key, 20), k6 = le32(key, 24), k7 = le32(key, 28);
  const n0 = le32(nonce, 0), n1 = le32(nonce, 4), n2 = le32(nonce, 8);
  let ctr = counter | 0;
  const words = fastPath && LITTLE_ENDIAN && data.byteOffset % 4 === 0 && out.byteOffset % 4 === 0;
  const d32 = words ? new Uint32Array(data.buffer, data.byteOffset, data.length >>> 2) : null;
  const o32 = words ? new Uint32Array(out.buffer, out.byteOffset, out.length >>> 2) : null;
  const xs = new Int32Array(16);
  for (let pos = 0; pos < data.length; pos += 64, ctr = (ctr + 1) | 0) {
    let x0 = s0, x1 = s1, x2 = s2, x3 = s3, x4 = k0, x5 = k1, x6 = k2, x7 = k3, x8 = k4, x9 = k5, x10 = k6, x11 = k7, x12 = ctr, x13 = n0, x14 = n1, x15 = n2;
    for (let i = 0; i < 10; i++) {
      x0 = (x0 + x4) | 0; x12 ^= x0; x12 = (x12 << 16) | (x12 >>> 16);
      x8 = (x8 + x12) | 0; x4 ^= x8; x4 = (x4 << 12) | (x4 >>> 20);
      x0 = (x0 + x4) | 0; x12 ^= x0; x12 = (x12 << 8) | (x12 >>> 24);
      x8 = (x8 + x12) | 0; x4 ^= x8; x4 = (x4 << 7) | (x4 >>> 25);
      x1 = (x1 + x5) | 0; x13 ^= x1; x13 = (x13 << 16) | (x13 >>> 16);
      x9 = (x9 + x13) | 0; x5 ^= x9; x5 = (x5 << 12) | (x5 >>> 20);
      x1 = (x1 + x5) | 0; x13 ^= x1; x13 = (x13 << 8) | (x13 >>> 24);
      x9 = (x9 + x13) | 0; x5 ^= x9; x5 = (x5 << 7) | (x5 >>> 25);
      x2 = (x2 + x6) | 0; x14 ^= x2; x14 = (x14 << 16) | (x14 >>> 16);
      x10 = (x10 + x14) | 0; x6 ^= x10; x6 = (x6 << 12) | (x6 >>> 20);
      x2 = (x2 + x6) | 0; x14 ^= x2; x14 = (x14 << 8) | (x14 >>> 24);
      x10 = (x10 + x14) | 0; x6 ^= x10; x6 = (x6 << 7) | (x6 >>> 25);
      x3 = (x3 + x7) | 0; x15 ^= x3; x15 = (x15 << 16) | (x15 >>> 16);
      x11 = (x11 + x15) | 0; x7 ^= x11; x7 = (x7 << 12) | (x7 >>> 20);
      x3 = (x3 + x7) | 0; x15 ^= x3; x15 = (x15 << 8) | (x15 >>> 24);
      x11 = (x11 + x15) | 0; x7 ^= x11; x7 = (x7 << 7) | (x7 >>> 25);
      x0 = (x0 + x5) | 0; x15 ^= x0; x15 = (x15 << 16) | (x15 >>> 16);
      x10 = (x10 + x15) | 0; x5 ^= x10; x5 = (x5 << 12) | (x5 >>> 20);
      x0 = (x0 + x5) | 0; x15 ^= x0; x15 = (x15 << 8) | (x15 >>> 24);
      x10 = (x10 + x15) | 0; x5 ^= x10; x5 = (x5 << 7) | (x5 >>> 25);
      x1 = (x1 + x6) | 0; x12 ^= x1; x12 = (x12 << 16) | (x12 >>> 16);
      x11 = (x11 + x12) | 0; x6 ^= x11; x6 = (x6 << 12) | (x6 >>> 20);
      x1 = (x1 + x6) | 0; x12 ^= x1; x12 = (x12 << 8) | (x12 >>> 24);
      x11 = (x11 + x12) | 0; x6 ^= x11; x6 = (x6 << 7) | (x6 >>> 25);
      x2 = (x2 + x7) | 0; x13 ^= x2; x13 = (x13 << 16) | (x13 >>> 16);
      x8 = (x8 + x13) | 0; x7 ^= x8; x7 = (x7 << 12) | (x7 >>> 20);
      x2 = (x2 + x7) | 0; x13 ^= x2; x13 = (x13 << 8) | (x13 >>> 24);
      x8 = (x8 + x13) | 0; x7 ^= x8; x7 = (x7 << 7) | (x7 >>> 25);
      x3 = (x3 + x4) | 0; x14 ^= x3; x14 = (x14 << 16) | (x14 >>> 16);
      x9 = (x9 + x14) | 0; x4 ^= x9; x4 = (x4 << 12) | (x4 >>> 20);
      x3 = (x3 + x4) | 0; x14 ^= x3; x14 = (x14 << 8) | (x14 >>> 24);
      x9 = (x9 + x14) | 0; x4 ^= x9; x4 = (x4 << 7) | (x4 >>> 25);
    }
    x0 = (x0 + s0) | 0; x1 = (x1 + s1) | 0; x2 = (x2 + s2) | 0; x3 = (x3 + s3) | 0;
    x4 = (x4 + k0) | 0; x5 = (x5 + k1) | 0; x6 = (x6 + k2) | 0; x7 = (x7 + k3) | 0;
    x8 = (x8 + k4) | 0; x9 = (x9 + k5) | 0; x10 = (x10 + k6) | 0; x11 = (x11 + k7) | 0;
    x12 = (x12 + ctr) | 0; x13 = (x13 + n0) | 0; x14 = (x14 + n1) | 0; x15 = (x15 + n2) | 0;
    if (d32 && o32 && pos + 64 <= data.length) {
      const w = pos >>> 2;
        o32[w + 0] = d32[w + 0] ^ x0;
        o32[w + 1] = d32[w + 1] ^ x1;
        o32[w + 2] = d32[w + 2] ^ x2;
        o32[w + 3] = d32[w + 3] ^ x3;
        o32[w + 4] = d32[w + 4] ^ x4;
        o32[w + 5] = d32[w + 5] ^ x5;
        o32[w + 6] = d32[w + 6] ^ x6;
        o32[w + 7] = d32[w + 7] ^ x7;
        o32[w + 8] = d32[w + 8] ^ x8;
        o32[w + 9] = d32[w + 9] ^ x9;
        o32[w + 10] = d32[w + 10] ^ x10;
        o32[w + 11] = d32[w + 11] ^ x11;
        o32[w + 12] = d32[w + 12] ^ x12;
        o32[w + 13] = d32[w + 13] ^ x13;
        o32[w + 14] = d32[w + 14] ^ x14;
        o32[w + 15] = d32[w + 15] ^ x15;
    } else {
      xs[0] = x0;
      xs[1] = x1;
      xs[2] = x2;
      xs[3] = x3;
      xs[4] = x4;
      xs[5] = x5;
      xs[6] = x6;
      xs[7] = x7;
      xs[8] = x8;
      xs[9] = x9;
      xs[10] = x10;
      xs[11] = x11;
      xs[12] = x12;
      xs[13] = x13;
      xs[14] = x14;
      xs[15] = x15;
      const n = Math.min(64, data.length - pos);
      for (let i = 0; i < n; i++) out[pos + i] = data[pos + i] ^ ((xs[i >>> 2] >>> ((i & 3) * 8)) & 255);
    }
  }
  return out;
}

/** Poly1305 one-time authenticator (13-bit limbs, so every product stays exact in a JavaScript number) */
export class Poly1305 {
  private r = new Int32Array(10);
  private h = new Int32Array(10);
  private pad = new Uint8Array(16);
  private buf = new Uint8Array(16);
  private bufLen = 0;

  constructor(key: Uint8Array) {
    if (key.length !== 32) throw new Error('key must be 32 bytes');
    const t0 = key[0] | (key[1] << 8), t1 = key[2] | (key[3] << 8), t2 = key[4] | (key[5] << 8), t3 = key[6] | (key[7] << 8);
    const t4 = key[8] | (key[9] << 8), t5 = key[10] | (key[11] << 8), t6 = key[12] | (key[13] << 8), t7 = key[14] | (key[15] << 8);
    const r = this.r;
    r[0] = t0 & 0x1fff;
    r[1] = ((t0 >>> 13) | (t1 << 3)) & 0x1fff;
    r[2] = ((t1 >>> 10) | (t2 << 6)) & 0x1f03;
    r[3] = ((t2 >>> 7) | (t3 << 9)) & 0x1fff;
    r[4] = ((t3 >>> 4) | (t4 << 12)) & 0x00ff;
    r[5] = (t4 >>> 1) & 0x1ffe;
    r[6] = ((t4 >>> 14) | (t5 << 2)) & 0x1fff;
    r[7] = ((t5 >>> 11) | (t6 << 5)) & 0x1f81;
    r[8] = ((t6 >>> 8) | (t7 << 8)) & 0x1fff;
    r[9] = (t7 >>> 5) & 0x007f;
    this.pad.set(key.subarray(16, 32));
  }

  /** `hibit` is 2048 (the 2^128 bit) for a full block, 0 for the padded last one */
  private blocks(m: Uint8Array, o: number, bytes: number, hibit: number): void {
    const R = this.r;
    const H = this.h;
    const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8], r9 = R[9];
    const s1 = 5 * r1, s2 = 5 * r2, s3 = 5 * r3, s4 = 5 * r4, s5 = 5 * r5, s6 = 5 * r6, s7 = 5 * r7, s8 = 5 * r8, s9 = 5 * r9;
    let h0 = H[0], h1 = H[1], h2 = H[2], h3 = H[3], h4 = H[4], h5 = H[5], h6 = H[6], h7 = H[7], h8 = H[8], h9 = H[9];
    for (; bytes >= 16; bytes -= 16, o += 16) {
      const t0 = m[o] | (m[o + 1] << 8), t1 = m[o + 2] | (m[o + 3] << 8), t2 = m[o + 4] | (m[o + 5] << 8), t3 = m[o + 6] | (m[o + 7] << 8);
      const t4 = m[o + 8] | (m[o + 9] << 8), t5 = m[o + 10] | (m[o + 11] << 8), t6 = m[o + 12] | (m[o + 13] << 8), t7 = m[o + 14] | (m[o + 15] << 8);
      h0 += t0 & 0x1fff;
      h1 += ((t0 >>> 13) | (t1 << 3)) & 0x1fff;
      h2 += ((t1 >>> 10) | (t2 << 6)) & 0x1fff;
      h3 += ((t2 >>> 7) | (t3 << 9)) & 0x1fff;
      h4 += ((t3 >>> 4) | (t4 << 12)) & 0x1fff;
      h5 += (t4 >>> 1) & 0x1fff;
      h6 += ((t4 >>> 14) | (t5 << 2)) & 0x1fff;
      h7 += ((t5 >>> 11) | (t6 << 5)) & 0x1fff;
      h8 += ((t6 >>> 8) | (t7 << 8)) & 0x1fff;
      h9 += (t7 >>> 5) | hibit;
    const d0 = h0 * r0 + h1 * s9 + h2 * s8 + h3 * s7 + h4 * s6 + h5 * s5 + h6 * s4 + h7 * s3 + h8 * s2 + h9 * s1;
    const d1 = h0 * r1 + h1 * r0 + h2 * s9 + h3 * s8 + h4 * s7 + h5 * s6 + h6 * s5 + h7 * s4 + h8 * s3 + h9 * s2;
    const d2 = h0 * r2 + h1 * r1 + h2 * r0 + h3 * s9 + h4 * s8 + h5 * s7 + h6 * s6 + h7 * s5 + h8 * s4 + h9 * s3;
    const d3 = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * s9 + h5 * s8 + h6 * s7 + h7 * s6 + h8 * s5 + h9 * s4;
    const d4 = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0 + h5 * s9 + h6 * s8 + h7 * s7 + h8 * s6 + h9 * s5;
    const d5 = h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1 + h5 * r0 + h6 * s9 + h7 * s8 + h8 * s7 + h9 * s6;
    const d6 = h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2 + h5 * r1 + h6 * r0 + h7 * s9 + h8 * s8 + h9 * s7;
    const d7 = h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3 + h5 * r2 + h6 * r1 + h7 * r0 + h8 * s9 + h9 * s8;
    const d8 = h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4 + h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * s9;
    const d9 = h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5 + h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
      let c = d0 >>> 13; h0 = d0 & 0x1fff;
      let t = d1 + c; c = t >>> 13; h1 = t & 0x1fff;
      t = d2 + c; c = t >>> 13; h2 = t & 0x1fff;
      t = d3 + c; c = t >>> 13; h3 = t & 0x1fff;
      t = d4 + c; c = t >>> 13; h4 = t & 0x1fff;
      t = d5 + c; c = t >>> 13; h5 = t & 0x1fff;
      t = d6 + c; c = t >>> 13; h6 = t & 0x1fff;
      t = d7 + c; c = t >>> 13; h7 = t & 0x1fff;
      t = d8 + c; c = t >>> 13; h8 = t & 0x1fff;
      t = d9 + c; c = t >>> 13; h9 = t & 0x1fff;
      c = (c << 2) + c; // the part above 2^130 comes back times 5 (2^130 = 5 mod p)
      t = h0 + c; h0 = t & 0x1fff; c = t >>> 13;
      h1 += c;
    }
    H[0] = h0; H[1] = h1; H[2] = h2; H[3] = h3; H[4] = h4; H[5] = h5; H[6] = h6; H[7] = h7; H[8] = h8; H[9] = h9;
  }

  update(data: Uint8Array): this {
    let o = 0;
    if (this.bufLen > 0) {
      const take = Math.min(16 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      o = take;
      if (this.bufLen < 16) return this;
      this.blocks(this.buf, 0, 16, 2048);
      this.bufLen = 0;
    }
    const whole = (data.length - o) & ~15;
    if (whole > 0) {
      this.blocks(data, o, whole, 2048);
      o += whole;
    }
    if (o < data.length) {
      this.buf.set(data.subarray(o), 0);
      this.bufLen = data.length - o;
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.bufLen > 0) {
      this.buf[this.bufLen] = 1;
      this.buf.fill(0, this.bufLen + 1);
      this.blocks(this.buf, 0, 16, 0);
      this.bufLen = 0;
    }
    const h = this.h;
    // carry until nothing is left over: every limb below 2^13 and no carry out of the top (the value is below 2^130)
    for (let pass = 0; pass < 8; pass++) {
      let c = 0;
      for (let i = 0; i < 10; i++) {
        const t = h[i] + c;
        c = t >>> 13;
        h[i] = t & 0x1fff;
      }
      if (c === 0) break;
      h[0] += c * 5;
    }
    // is h >= p (p = 2^130 - 5)? then take h - p, that is (h + 5) without the bit at 2^130
    const g = new Int32Array(10);
    let c = 5;
    for (let i = 0; i < 10; i++) {
      const t = h[i] + c;
      c = t >>> 13;
      g[i] = t & 0x1fff;
    }
    const use = c === 1 ? g : h;
    // the low 128 bits, as bytes
    const out = new Uint8Array(16);
    let acc = 0;
    let accBits = 0;
    let o = 0;
    for (let i = 0; i < 10 && o < 16; i++) {
      acc |= use[i] << accBits;
      accBits += 13;
      while (accBits >= 8 && o < 16) {
        out[o++] = acc & 255;
        acc >>>= 8;
        accBits -= 8;
      }
    }
    // + the second half of the key, modulo 2^128
    let carry = 0;
    for (let i = 0; i < 16; i++) {
      const v = out[i] + this.pad[i] + carry;
      out[i] = v & 255;
      carry = v >> 8;
    }
    return out;
  }
}

const TAG = 16;
const zeros16 = new Uint8Array(16);

function lengths(aad: number, ct: number): Uint8Array {
  const b = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    b[i] = (aad >>> (8 * i)) & 255;
    b[8 + i] = (ct >>> (8 * i)) & 255;
  }
  b[4] = Math.floor(aad / 0x100000000) & 255;
  b[12] = Math.floor(ct / 0x100000000) & 255;
  return b;
}

function mac(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ct: Uint8Array): Uint8Array {
  const polyKey = chacha20Xor(key, nonce, 0, new Uint8Array(32));
  const p = new Poly1305(polyKey);
  p.update(aad);
  if (aad.length % 16) p.update(zeros16.subarray(0, 16 - (aad.length % 16)));
  p.update(ct);
  if (ct.length % 16) p.update(zeros16.subarray(0, 16 - (ct.length % 16)));
  p.update(lengths(aad.length, ct.length));
  return p.digest();
}

/** encrypts: returns the ciphertext followed by the 16-byte tag */
export function aeadSeal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const out = new Uint8Array(plaintext.length + TAG);
  out.set(plaintext);
  const ct = out.subarray(0, plaintext.length);
  chacha20Xor(key, nonce, 1, ct, ct);
  out.set(mac(key, nonce, aad, ct), plaintext.length);
  return out;
}

/** decrypts and checks the tag: null when the key is wrong or anything (data, aad, nonce) was changed */
export function aeadOpen(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Uint8Array | null {
  if (sealed.length < TAG) return null;
  const ctLen = sealed.length - TAG;
  const ct = sealed.subarray(0, ctLen);
  if (!constantTimeEqual(mac(key, nonce, aad, ct), sealed.subarray(ctLen))) return null;
  const copy = new Uint8Array(ctLen); // a fresh, word-aligned buffer (also keeps the caller's bytes unchanged)
  copy.set(ct);
  return chacha20Xor(key, nonce, 1, copy, copy);
}

export { concatBytes };
