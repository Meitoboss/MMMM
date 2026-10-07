import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BEAT_CHOICES, FAR_FROM_ONE, MAX_BPM, MAX_RATE, MIN_BPM, MIN_RATE, MIN_TAPS, TAP_RESET_MS,
  addTap, beatLoopRegion, beatSeconds, beatsBetween, clampBpm, doubleBpm, effectiveBpm, estimateBpm, formatBpm,
  halveBpm, matchRate, nearestBeat, parseBpmText, roundBpm, scaleLoopRegion, validBpm,
} from '../src/core/beat';

/** taps at a steady tempo, with some jitter */
const tapsAt = (bpm: number, n: number, start = 1000, jitter: number[] = []) => Array.from({ length: n }, (_, i) => Math.round(start + (i * 60000) / bpm + (jitter[i] ?? 0)));

describe('BPM numbers', () => {
  it('valid range, rounding and display', () => {
    assert.ok(validBpm(MIN_BPM) && validBpm(MAX_BPM) && validBpm(128.5));
    for (const bad of [29.9, 300.1, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, '128' as never, null as never]) assert.ok(!validBpm(bad), String(bad));
    assert.equal(roundBpm(127.96), 128);
    assert.equal(roundBpm(127.44), 127.4);
    assert.equal(clampBpm(1000), MAX_BPM);
    assert.equal(clampBpm(1), MIN_BPM);
    assert.equal(formatBpm(128), '128');
    assert.equal(formatBpm(127.5), '127.5');
    assert.equal(formatBpm(127.96), '128');
    assert.equal(beatSeconds(120), 0.5);
  });

  it('typed text: half-width or full-width digits, one or two decimals, nothing else', () => {
    assert.equal(parseBpmText('128'), 128);
    assert.equal(parseBpmText(' 127.5 '), 127.5);
    assert.equal(parseBpmText('１２８'), 128);
    assert.equal(parseBpmText('１２７．５'), 127.5);
    assert.equal(parseBpmText('127.55'), 127.6);
    for (const bad of ['', 'abc', '12', '301', '128bpm', '1e2', '-128', '128.555', '1,28', '12 8']) assert.equal(parseBpmText(bad), null, bad);
  });

  it('half / double stay as they are when the result would be out of range', () => {
    assert.equal(halveBpm(128), 64);
    assert.equal(doubleBpm(70), 140);
    assert.equal(halveBpm(MIN_BPM + 5), MIN_BPM + 5);
    assert.equal(doubleBpm(200), 200);
    assert.equal(doubleBpm(127.5), 255);
  });
});

describe('tapping the tempo', () => {
  it('needs enough taps; then gives the tempo', () => {
    assert.equal(estimateBpm([]), null);
    assert.equal(estimateBpm(tapsAt(120, MIN_TAPS - 1)), null);
    assert.deepEqual(estimateBpm(tapsAt(120, MIN_TAPS)), { bpm: 120, taps: MIN_TAPS });
    assert.equal(estimateBpm(tapsAt(128, 8))?.bpm, 128);
    assert.equal(estimateBpm(tapsAt(87.5, 10))?.bpm, 87.5);
  });

  it('human jitter (±25 ms) still gives the right tempo within a tenth or so', () => {
    const jitter = [0, 20, -25, 15, -10, 25, -20, 10, -15, 5];
    const e = estimateBpm(tapsAt(128, 10, 1000, jitter))!;
    assert.ok(Math.abs(e.bpm - 128) < 1.5, `${e.bpm}`);
  });

  it('one stray tap (a double tap or a miss) is ignored', () => {
    const taps = tapsAt(120, 9);
    const withExtra = [...taps.slice(0, 4), taps[4] + 60, ...taps.slice(5)]; // one tap came 60 ms late
    assert.equal(estimateBpm(withExtra)?.bpm !== undefined, true);
    assert.ok(Math.abs(estimateBpm(withExtra)!.bpm - 120) < 3);
    const doubleTap = [...taps.slice(0, 4), taps[3] + 40, ...taps.slice(4)]; // an extra tap 40 ms after one
    assert.ok(Math.abs(estimateBpm(doubleTap)!.bpm - 120) < 3);
  });

  it('a pause starts a new count; going back in time too; only the latest taps are kept', () => {
    let t: number[] = [];
    for (const x of tapsAt(120, 5)) t = addTap(t, x);
    assert.equal(t.length, 5);
    t = addTap(t, t[4] + TAP_RESET_MS + 1);
    assert.equal(t.length, 1, 'after a long pause');
    t = addTap([1000, 1500], 900);
    assert.deepEqual(t, [900], 'the clock went back');
    let many: number[] = [];
    for (let i = 0; i < 40; i++) many = addTap(many, 1000 + i * 500);
    assert.equal(many.length, 16);
    assert.equal(estimateBpm(many)?.bpm, 120);
  });

  it('nonsense intervals give nothing (all taps at once; a crawl)', () => {
    assert.equal(estimateBpm([1000, 1000, 1000, 1000]), null);
    assert.equal(estimateBpm(tapsAt(20, 5)), null, 'slower than the lowest BPM');
    assert.equal(estimateBpm(tapsAt(400, 5)), null, 'faster than the highest BPM');
  });
});

describe('the beat grid', () => {
  const info = { bpm: 120, anchor: 10.1 }; // a beat every 0.5 s: …, 9.6, 10.1, 10.6, …
  it('the nearest beat, forwards and backwards from the anchor', () => {
    assert.ok(Math.abs(nearestBeat(10.2, info) - 10.1) < 1e-9);
    assert.ok(Math.abs(nearestBeat(10.4, info) - 10.6) < 1e-9);
    assert.ok(Math.abs(nearestBeat(30.3, info) - 30.1) < 1e-9);
    assert.ok(Math.abs(nearestBeat(30.37, info) - 30.6) < 1e-9, '30.6 is nearer than 30.1');
    assert.ok(Math.abs(nearestBeat(1.0, info) - 1.1) < 1e-9, 'before the anchor too');
  });
  it('without a marked beat the position itself', () => {
    assert.equal(nearestBeat(12.34, { bpm: 120 }), 12.34);
  });
  it('never before the start of the song', () => {
    const t = nearestBeat(0.05, { bpm: 120, anchor: 10.1 });
    assert.ok(t >= 0, `${t}`);
  });

  it('beat loops: 4 beats at 120 BPM are 2 seconds, starting on the beat', () => {
    const r = beatLoopRegion(10.45, info, 4, 200)!;
    assert.ok(Math.abs(r.start - 10.6) < 1e-9);
    assert.ok(Math.abs(r.end - 12.6) < 1e-9);
    for (const n of BEAT_CHOICES) {
      const q = beatLoopRegion(50, info, n, 200)!;
      assert.ok(Math.abs(q.end - q.start - n * 0.5) < 1e-9, `${n} beats`);
    }
  });
  it('without a marked beat it starts exactly where you are', () => {
    assert.deepEqual(beatLoopRegion(33.3, { bpm: 120 }, 2, 200), { start: 33.3, end: 34.3 });
  });
  it('does not fit the song, or bad input: no loop', () => {
    assert.equal(beatLoopRegion(199.5, { bpm: 120 }, 8, 200), null, 'only half a second is left: not a cut-short "8 beats"');
    assert.deepEqual(beatLoopRegion(198, { bpm: 120 }, 4, 200), { start: 198, end: 200 }, 'exactly fits');
    assert.equal(beatLoopRegion(10, { bpm: 0 }, 4, 200), null);
    assert.equal(beatLoopRegion(Number.NaN, info, 4, 200), null);
    assert.equal(beatLoopRegion(10, info, 0, 200), null);
    assert.equal(beatLoopRegion(10, { bpm: 300 }, 1, 200), null, 'a 1-beat loop at 300 BPM is 0.2 s: too short');
    assert.ok(beatLoopRegion(10, { bpm: 300 }, 4, 200), 'but 4 beats are fine');
  });

  it('half and double the loop from the same start', () => {
    const l = { start: 10, end: 12 };
    assert.deepEqual(scaleLoopRegion(l, 2, 200), { start: 10, end: 14 });
    assert.deepEqual(scaleLoopRegion(l, 0.5, 200), { start: 10, end: 11 });
    assert.equal(scaleLoopRegion({ start: 10, end: 10.8 }, 0.5, 200), null, 'would be under half a second');
    assert.equal(scaleLoopRegion({ start: 190, end: 196 }, 2, 200), null, 'runs past the end of the song');
    assert.equal(scaleLoopRegion(l, 0, 200), null);
    assert.equal(scaleLoopRegion(l, -1, 200), null);
  });

  it('the beats in a stretch (for a display)', () => {
    assert.deepEqual(beatsBetween(0, 2, { bpm: 120, anchor: 0.25 }).map((x) => Math.round(x * 100) / 100), [0.25, 0.75, 1.25, 1.75]);
    assert.deepEqual(beatsBetween(0, 2, { bpm: 120 }), [], 'no grid without a marked beat');
    assert.equal(beatsBetween(0, 100000, { bpm: 300, anchor: 0 }, 50).length, 50, 'a limit');
  });
});

describe('matching the tempo of two songs', () => {
  it('the speed that brings the current song to the other one', () => {
    assert.deepEqual(matchRate(120, 128), { rate: 1.067, via: 'same', far: false });
    assert.deepEqual(matchRate(128, 120), { rate: 0.938, via: 'same', far: false });
    assert.deepEqual(matchRate(120, 120), { rate: 1, via: 'same', far: false });
  });
  it('an octave away is the same beat: 70 against 140 needs no change; 65 against 140 only a little', () => {
    assert.deepEqual(matchRate(70, 140), { rate: 1, via: 'half', far: false });
    assert.deepEqual(matchRate(140, 70), { rate: 1, via: 'double', far: false });
    const m = matchRate(65, 140)!;
    assert.equal(m.via, 'half');
    assert.ok(Math.abs(m.rate - 1.077) < 0.001);
  });
  it('a big change is marked (it will sound stretched)', () => {
    const m = matchRate(100, 130)!;
    assert.equal(m.far, true);
    assert.ok(Math.abs(m.rate - 1.3) < 1e-9 && Math.abs(m.rate - 1) > FAR_FROM_ONE);
    assert.equal(matchRate(100, 124)!.far, false);
  });
  it('out of what the player can do, or unknown tempos: null', () => {
    assert.equal(matchRate(30, 300), null, 'ten times faster; even an octave away is out of range');
    assert.equal(matchRate(0, 120), null);
    assert.equal(matchRate(120, Number.NaN), null);
    const m = matchRate(50, 300);
    assert.ok(m === null || (m.rate >= MIN_RATE && m.rate <= MAX_RATE));
  });
  it('the tempo you hear', () => {
    assert.equal(effectiveBpm(120, 1.067), 128);
    assert.equal(effectiveBpm(128, 1), 128);
  });
});
