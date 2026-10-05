import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JUMP_LEAD, LAST_LINE_SECONDS, MIN_LOOP_SECONDS, SETTLE_MS, lineRegion, loopJumpTarget, makeLoop } from '../src/core/loop';

describe('making a loop', () => {
  it('A and B in either order', () => {
    assert.deepEqual(makeLoop(10, 20), { start: 10, end: 20 });
    assert.deepEqual(makeLoop(20, 10), { start: 10, end: 20 });
  });
  it('too short, or not a number: no loop', () => {
    assert.equal(makeLoop(10, 10), null);
    assert.equal(makeLoop(10, 10 + MIN_LOOP_SECONDS - 0.01), null);
    assert.ok(makeLoop(10, 10 + MIN_LOOP_SECONDS));
    assert.equal(makeLoop(Number.NaN, 10), null);
    assert.equal(makeLoop(1, Number.POSITIVE_INFINITY), null);
  });
  it('stays inside the song', () => {
    assert.deepEqual(makeLoop(-5, 20), { start: 0, end: 20 });
    assert.deepEqual(makeLoop(190, 230, 200), { start: 190, end: 200 });
    assert.equal(makeLoop(199.9, 230, 200), null, 'what is left inside the song is too short');
  });
});

describe('when to jump back', () => {
  const loop = { start: 30, end: 40 };
  it('plays on inside the loop', () => {
    assert.equal(loopJumpTarget(35, loop, 10_000, 0), null);
    assert.equal(loopJumpTarget(39.5, loop, 10_000, 0), null);
  });
  it('jumps back to A at B – a little early, because events come every 0.25 s', () => {
    assert.equal(loopJumpTarget(40 - JUMP_LEAD, loop, 10_000, 0), 30);
    assert.equal(loopJumpTarget(40.2, loop, 10_000, 0), 30);
  });
  it('a position far past B (the user dragged the slider) is pulled back as well', () => {
    assert.equal(loopJumpTarget(120, loop, 10_000, 0), 30);
  });
  it('right after a jump the old positions are ignored (no double jump)', () => {
    assert.equal(loopJumpTarget(40.5, loop, 10_000, 10_000 - 100), null);
    assert.equal(loopJumpTarget(40.5, loop, 10_000, 10_000 - SETTLE_MS), 30);
  });
  it('no loop, or a broken position: nothing to do', () => {
    assert.equal(loopJumpTarget(35, null, 10_000, 0), null);
    assert.equal(loopJumpTarget(Number.NaN, loop, 10_000, 0), null);
  });
  it('before A the song just plays up to the loop', () => {
    assert.equal(loopJumpTarget(5, loop, 10_000, 0), null);
  });
});

describe('looping one lyric line', () => {
  const times = [0, 12_000, 12_000, 20_500, 31_000]; // ms – note the doubled time
  it('from the line to the next different time', () => {
    assert.deepEqual(lineRegion(times, 0, 240), { start: 0, end: 12 });
    assert.deepEqual(lineRegion(times, 1, 240), { start: 12, end: 20.5 }, 'a line with the same time as the next one: skip to the next later time');
    assert.deepEqual(lineRegion(times, 3, 240), { start: 20.5, end: 31 });
  });
  it('the last line has no next line', () => {
    assert.deepEqual(lineRegion(times, 4, 240), { start: 31, end: 31 + LAST_LINE_SECONDS });
    assert.deepEqual(lineRegion(times, 4, 35), { start: 31, end: 35 }, 'but never past the end of the song');
  });
  it('unknown line: nothing', () => {
    assert.equal(lineRegion(times, 9, 240), null);
    assert.equal(lineRegion([], 0), null);
  });
});
