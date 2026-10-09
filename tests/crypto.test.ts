import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2Sync, randomBytes as nodeRandom } from 'node:crypto';
import { describe, it } from 'node:test';

import { concatBytes, constantTimeEqual, readU32le, u32le, utf8Decode, utf8Encode } from '../src/core/crypto/bytes';
import { Poly1305, __setFastPath, aeadOpen, aeadSeal, chacha20Xor } from '../src/core/crypto/chacha20poly1305';
import { hasSecureRandom, randomBytes } from '../src/core/crypto/random';
import { Sha256, hmacSha256, pbkdf2Sha256, sha256 } from '../src/core/crypto/sha256';

const rnd = (n: number): Uint8Array => new Uint8Array(nodeRandom(n));
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const same = (a: Uint8Array, b: Uint8Array | Buffer, msg?: string) => assert.equal(hex(a), Buffer.from(b).toString('hex'), msg);

/** the lengths that sit on or next to a block boundary, and a few odd ones */
const LENGTHS = [0, 1, 2, 15, 16, 17, 31, 32, 33, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 255, 256, 257, 1000, 4096, 65535, 65536, 65537];

describe('bytes', () => {
  it('UTF-8 both ways, like Node – including emoji, Japanese, and a lone surrogate', () => {
    for (const s of ['', 'abc', 'こんにちは', '秘密のキー🔑', 'é ñ ü', '𠮷野家', 'a\u0000b']) {
      same(utf8Encode(s), Buffer.from(s, 'utf8'), s);
      assert.equal(utf8Decode(utf8Encode(s)), s);
    }
    same(utf8Encode('a\ud800b'), Buffer.from('a\ufffdb', 'utf8'), 'a lone surrogate becomes U+FFFD');
  });
  it('broken UTF-8 becomes U+FFFD and never throws', () => {
    for (let i = 0; i < 300; i++) assert.doesNotThrow(() => utf8Decode(rnd(1 + (i % 40))));
    assert.equal(utf8Decode(Uint8Array.of(0xff, 0x41)), '\ufffdA');
    assert.equal(utf8Decode(Uint8Array.of(0xc0, 0x80)), '\ufffd\ufffd', 'an overlong form is not accepted');
  });
  it('concat, 32-bit numbers and the constant-time compare', () => {
    assert.deepEqual([...concatBytes(Uint8Array.of(1), new Uint8Array(0), Uint8Array.of(2, 3))], [1, 2, 3]);
    for (const n of [0, 1, 255, 256, 65535, 65536, 0x7fffffff, 0x80000000, 0xffffffff]) assert.equal(readU32le(u32le(n), 0), n);
    assert.ok(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2)));
    assert.ok(!constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3)));
    assert.ok(!constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1)));
  });
});

describe('SHA-256, HMAC and PBKDF2 against Node', () => {
  it('SHA-256 of every interesting length, in one piece and in odd slices', () => {
    for (const n of LENGTHS) {
      const data = rnd(n);
      same(sha256(data), createHash('sha256').update(data).digest(), `length ${n}`);
      const s = new Sha256();
      for (let o = 0; o < n; ) {
        const step = 1 + ((o * 7 + 3) % 70);
        s.update(data.subarray(o, o + step));
        o += step;
      }
      same(s.digest(), createHash('sha256').update(data).digest(), `sliced ${n}`);
    }
  });
  it('known values', () => {
    assert.equal(hex(sha256(new Uint8Array(0))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(hex(sha256(utf8Encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('HMAC with short, 64-byte and long keys', () => {
    for (const keyLen of [0, 1, 20, 32, 63, 64, 65, 131, 200]) {
      for (const n of [0, 1, 55, 64, 100, 1000]) {
        const key = rnd(keyLen);
        const data = rnd(n);
        same(hmacSha256(key, data), createHmac('sha256', key).update(data).digest(), `key ${keyLen} data ${n}`);
      }
    }
  });
  it('PBKDF2: several lengths, salts and iteration counts (also a second block and a cut-off block)', async () => {
    for (const [iter, dk, saltLen, pwLen] of [[1, 32, 16, 8], [2, 32, 16, 8], [1000, 32, 16, 12], [4001, 32, 16, 12], [3, 64, 0, 0], [10, 20, 33, 70], [5000, 45, 16, 5]]) {
      const pw = rnd(pwLen);
      const salt = rnd(saltLen);
      same(await pbkdf2Sha256(pw, salt, iter, dk), pbkdf2Sync(pw, salt, iter, dk, 'sha256'), `iter ${iter} dk ${dk}`);
    }
  });
  it('PBKDF2 reports progress, can be cancelled, and refuses nonsense', async () => {
    const seen: number[] = [];
    await pbkdf2Sha256(rnd(8), rnd(16), 20000, 32, { sliceIterations: 5000, onProgress: (f) => seen.push(f) });
    assert.ok(seen.length >= 4 && seen.at(-1) === 1 && seen.every((v, i) => i === 0 || v >= seen[i - 1]), JSON.stringify(seen));
    await assert.rejects(() => pbkdf2Sha256(rnd(8), rnd(16), 50000, 32, { sliceIterations: 1000, isCancelled: () => true }), /cancelled/);
    await assert.rejects(() => pbkdf2Sha256(rnd(8), rnd(16), 0, 32), /iterations/);
    await assert.rejects(() => pbkdf2Sha256(rnd(8), rnd(16), 1.5, 32), /iterations/);
  });
});

describe('ChaCha20 against Node', () => {
  const nodeXor = (key: Uint8Array, nonce: Uint8Array, counter: number, data: Uint8Array) => {
    // Node's "chacha20" takes a 16-byte IV: the 32-bit counter (little endian) followed by the 96-bit nonce
    const iv = Buffer.concat([Buffer.from(u32le(counter)), Buffer.from(nonce)]);
    return createCipheriv('chacha20', key, iv).update(data);
  };
  for (const fast of [true, false]) {
    it(`every length and several block counters (${fast ? 'word path' : 'byte path'})`, () => {
      __setFastPath(fast);
      try {
        for (const n of LENGTHS) for (const counter of [0, 1, 7, 0xfffffffe]) {
          if (counter === 0xfffffffe && n > 128) continue; // two blocks fit below the end of the 32-bit counter, a third would wrap
          const key = rnd(32), nonce = rnd(12), data = rnd(n);
          same(chacha20Xor(key, nonce, counter, data), nodeXor(key, nonce, counter, data), `length ${n} counter ${counter}`);
        }
      } finally {
        __setFastPath(true);
      }
    });
  }
  it('data that does not start on a word boundary, and in place', () => {
    const key = rnd(32), nonce = rnd(12);
    const big = rnd(1000);
    const view = big.subarray(3, 3 + 517); // byteOffset 3
    const want = nodeXor(key, nonce, 1, view);
    same(chacha20Xor(key, nonce, 1, view), want);
    const copy = Uint8Array.from(view);
    chacha20Xor(key, nonce, 1, copy, copy);
    same(copy, want, 'in place');
    const out = new Uint8Array(600).subarray(1, 518);
    chacha20Xor(key, nonce, 1, view, out);
    same(out, want, 'into an unaligned output');
  });
  it('the 32-bit block counter is never allowed to wrap (that would repeat the keystream)', () => {
    const key = rnd(32), nonce = rnd(12);
    assert.doesNotThrow(() => chacha20Xor(key, nonce, 0xfffffffe, rnd(128)));
    assert.throws(() => chacha20Xor(key, nonce, 0xfffffffe, rnd(129)), /overflow/);
    assert.throws(() => chacha20Xor(key, nonce, 0xffffffff, rnd(65)), /overflow/);
    assert.throws(() => chacha20Xor(key, nonce, -1, rnd(1)), /overflow/);
  });
  it('wrong key or nonce size is refused', () => {
    assert.throws(() => chacha20Xor(rnd(31), rnd(12), 0, rnd(5)), /32 bytes/);
    assert.throws(() => chacha20Xor(rnd(32), rnd(8), 0, rnd(5)), /12 bytes/);
  });
});

describe('Poly1305 and the AEAD against Node', () => {
  const nodeSeal = (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, pt: Uint8Array) => {
    const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    c.setAAD(aad);
    const ct = Buffer.concat([c.update(pt), c.final()]);
    return Buffer.concat([ct, c.getAuthTag()]);
  };
  for (const fast of [true, false]) {
    it(`sealing gives byte-for-byte what Node gives – every length, with and without data to authenticate (${fast ? 'word path' : 'byte path'})`, () => {
      __setFastPath(fast);
      try {
        for (const n of LENGTHS) for (const aadLen of [0, 1, 16, 30, 33]) {
          const key = rnd(32), nonce = rnd(12), aad = rnd(aadLen), pt = rnd(n);
          same(aeadSeal(key, nonce, aad, pt), nodeSeal(key, nonce, aad, pt), `plaintext ${n} aad ${aadLen}`);
        }
      } finally {
        __setFastPath(true);
      }
    });
  }
  it('Node can open what we seal, and we can open what Node seals', () => {
    for (const n of LENGTHS) {
      const key = rnd(32), nonce = rnd(12), aad = rnd(21), pt = rnd(n);
      const sealed = aeadSeal(key, nonce, aad, pt);
      const d = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
      d.setAAD(aad);
      d.setAuthTag(Buffer.from(sealed.subarray(n)));
      same(Buffer.concat([d.update(sealed.subarray(0, n)), d.final()]), pt, `Node opens ${n}`);
      same(aeadOpen(key, nonce, aad, Uint8Array.from(nodeSeal(key, nonce, aad, pt)))!, pt, `we open ${n}`);
    }
  });
  it('RFC 8439 test vector (section 2.8.2)', () => {
    const key = Uint8Array.from(Buffer.from('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f', 'hex'));
    const nonce = Uint8Array.from(Buffer.from('070000004041424344454647', 'hex'));
    const aad = Uint8Array.from(Buffer.from('50515253c0c1c2c3c4c5c6c7', 'hex'));
    const pt = utf8Encode("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
    const sealed = aeadSeal(key, nonce, aad, pt);
    assert.equal(hex(sealed.subarray(sealed.length - 16)), '1ae10b594f09e26a7e902ecbd0600691');
    assert.equal(hex(sealed.subarray(0, 16)), 'd31a8d34648e60db7b86afbc53ef7ec2');
  });
  it('Poly1305 on its own, in pieces of every size', () => {
    for (let trial = 0; trial < 60; trial++) {
      const key = rnd(32), data = rnd(trial * 13);
      const want = createHmac('sha256', key); // not used: Node has no raw Poly1305 – compare piecewise against whole instead
      void want;
      const whole = new Poly1305(key).update(data).digest();
      const p = new Poly1305(key);
      for (let o = 0; o < data.length; ) {
        const step = 1 + ((o + trial) % 23);
        p.update(data.subarray(o, o + step));
        o += step;
      }
      same(p.digest(), whole, `trial ${trial}`);
    }
  });
  it('any change is noticed: the key, the nonce, the aad, every byte of the data, every byte of the tag, a cut or an extra byte', () => {
    const key = rnd(32), nonce = rnd(12), aad = rnd(8), pt = rnd(100);
    const sealed = aeadSeal(key, nonce, aad, pt);
    same(aeadOpen(key, nonce, aad, sealed)!, pt);
    for (let i = 0; i < sealed.length; i++) {
      const bad = Uint8Array.from(sealed);
      bad[i] ^= 1 << (i % 8);
      assert.equal(aeadOpen(key, nonce, aad, bad), null, `byte ${i}`);
    }
    const k2 = Uint8Array.from(key); k2[31] ^= 1;
    const n2 = Uint8Array.from(nonce); n2[0] ^= 1;
    const a2 = Uint8Array.from(aad); a2[7] ^= 1;
    assert.equal(aeadOpen(k2, nonce, aad, sealed), null);
    assert.equal(aeadOpen(key, n2, aad, sealed), null);
    assert.equal(aeadOpen(key, nonce, a2, sealed), null);
    assert.equal(aeadOpen(key, nonce, aad.subarray(0, 7), sealed), null);
    assert.equal(aeadOpen(key, nonce, aad, sealed.subarray(0, sealed.length - 1)), null);
    assert.equal(aeadOpen(key, nonce, aad, concatBytes(sealed, Uint8Array.of(0))), null);
    assert.equal(aeadOpen(key, nonce, aad, sealed.subarray(0, 10)), null);
    assert.equal(aeadOpen(key, nonce, aad, new Uint8Array(0)), null);
  });
  it('opening does not change the bytes it was given', () => {
    const key = rnd(32), nonce = rnd(12), sealed = aeadSeal(key, nonce, new Uint8Array(0), rnd(200));
    const before = hex(sealed);
    aeadOpen(key, nonce, new Uint8Array(0), sealed);
    assert.equal(hex(sealed), before);
  });
  it('a large random battery: random keys, nonces, lengths and aad', () => {
    for (let i = 0; i < 150; i++) {
      const n = Math.floor(Math.random() * 3000);
      const key = rnd(32), nonce = rnd(12), aad = rnd(Math.floor(Math.random() * 60)), pt = rnd(n);
      const sealed = aeadSeal(key, nonce, aad, pt);
      same(sealed, nodeSeal(key, nonce, aad, pt), `round ${i}`);
      same(aeadOpen(key, nonce, aad, sealed)!, pt);
    }
  });
});

describe('random bytes', () => {
  it('uses the secure source when there is one', () => {
    const r = randomBytes(32);
    assert.equal(r.secure, hasSecureRandom());
    assert.equal(r.bytes.length, 32);
  });
  it('without a secure source: says so, and still gives different bytes each time (enough for a salt)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = randomBytes(16, null);
      assert.equal(r.secure, false);
      assert.equal(r.bytes.length, 16);
      seen.add(hex(r.bytes));
    }
    assert.equal(seen.size, 200);
    assert.equal(randomBytes(100, null).bytes.length, 100);
    assert.equal(randomBytes(0, null).bytes.length, 0);
  });
  it('a source that fills the bytes is called as it should be', () => {
    const r = randomBytes(8, { getRandomValues: (a) => { a.fill(7); return a; } });
    assert.deepEqual([...r.bytes], [7, 7, 7, 7, 7, 7, 7, 7]);
    assert.equal(r.secure, true);
  });
});
