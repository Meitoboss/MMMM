import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THUMB, clamp01, fillWidth, fractionAt, thumbLeft, valueAtX } from '../src/core/seekBarMath';

const W = 318; // a bar 318 wide: the thumb's centre runs over 300 (from 9 to 309)

describe('the geometry of the app\'s own seek bar', () => {
  it('the ends of the bar are the start and the end of the song', () => {
    assert.equal(fractionAt(THUMB / 2, W), 0);
    assert.equal(fractionAt(W - THUMB / 2, W), 1);
    assert.equal(fractionAt(W / 2, W), 0.5);
  });

  it('a finger outside the bar (it keeps the touch while it moves) is held at the nearest end', () => {
    assert.equal(fractionAt(-80, W), 0);
    assert.equal(fractionAt(0, W), 0);
    assert.equal(fractionAt(W + 200, W), 1);
  });

  it('the value is the fraction of the song\'s length', () => {
    assert.equal(valueAtX(W / 2, W, 240), 120);
    assert.equal(valueAtX(-5, W, 240), 0);
    assert.equal(valueAtX(9999, W, 240), 240);
    assert.ok(Math.abs(valueAtX(9 + 75, W, 240) - 60) < 1e-9, 'a quarter of the way');
  });

  it('the thumb is under the finger: the thumb\'s centre is at x (inside the bar)', () => {
    for (const x of [9, 40, 120, 159, 250, 309]) {
      const v = valueAtX(x, W, 240);
      assert.ok(Math.abs(thumbLeft(v, 240, W) + THUMB / 2 - x) < 1e-9, String(x));
    }
  });

  it('the thumb stays inside the bar; the coloured part reaches the thumb\'s centre', () => {
    assert.equal(thumbLeft(0, 240, W), 0);
    assert.equal(thumbLeft(240, 240, W), W - THUMB);
    assert.equal(thumbLeft(500, 240, W), W - THUMB, 'a value past the end');
    assert.equal(thumbLeft(-3, 240, W), 0);
    assert.equal(fillWidth(0, 240, W), THUMB / 2);
    assert.equal(fillWidth(240, 240, W), W - THUMB / 2);
  });

  it('nothing is measured yet (width 0), no length, or nonsense: no thumb movement, never NaN', () => {
    assert.equal(fractionAt(100, 0), 0);
    assert.equal(fractionAt(100, THUMB), 0);
    assert.equal(thumbLeft(10, 0, W), 0);
    assert.equal(thumbLeft(10, 240, 0), 0);
    assert.equal(fillWidth(10, 240, 0), 0);
    assert.equal(valueAtX(100, W, 0), 0);
    assert.equal(valueAtX(Number.NaN, W, 240), 0);
    assert.equal(clamp01(Number.NaN), 0);
    assert.equal(clamp01(Infinity), 0);
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(-2), 0);
  });
});
