import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TONE_RATE, TONE_SECONDS, base64Encode, toneHz, toneSamples, wavBytes } from '../src/core/tone';

describe('tone frequency', () => {
  it('holds a whole number of cycles in the loop', () => {
    for (const requested of [432, 396.3, 528, 100.04]) {
      const hz = toneHz(requested);
      assert.equal(Math.abs(hz * TONE_SECONDS - Math.round(hz * TONE_SECONDS)) < 1e-9, true);
      assert.ok(Math.abs(hz - requested) <= 0.05);
    }
  });

  it('clamps to the range and falls back for nonsense', () => {
    assert.equal(toneHz(1), 20);
    assert.equal(toneHz(99999), 2000);
    assert.equal(toneHz(Number.NaN), 432);
  });
});

describe('tone samples and file', () => {
  it('makes one loop whose end joins its start with no bigger step than any other step', () => {
    const s = toneSamples(432);
    assert.equal(s.length, TONE_SECONDS * TONE_RATE);
    let biggest = 0;
    for (let i = 1; i < s.length; i += 1) biggest = Math.max(biggest, Math.abs(s[i] - s[i - 1]));
    assert.ok(Math.abs(s[0] - s[s.length - 1]) <= biggest + 1);
  });

  it('writes a WAV file with the right header', () => {
    const samples = new Int16Array([1, -2, 3]);
    const b = wavBytes(samples, 44_100);
    const text = (at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));
    assert.equal(text(0, 4), 'RIFF');
    assert.equal(text(8, 4), 'WAVE');
    assert.equal(text(36, 4), 'data');
    assert.equal(b.length, 44 + 6);
  });

  it('encodes base64 like the standard encoder', () => {
    const enc = (s: string) => base64Encode(new TextEncoder().encode(s));
    assert.equal(enc(''), '');
    assert.equal(enc('f'), 'Zg==');
    assert.equal(enc('fo'), 'Zm8=');
    assert.equal(enc('foo'), 'Zm9v');
    assert.equal(enc('foobar'), 'Zm9vYmFy');
  });
});
