import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ECHO_TOLERANCE, isEcho } from '../src/core/seekDrag';
import { DOUBLED_MAX, DOUBLED_MIN, isDoubledDuration, seekLength, songEnd } from '../src/core/songLength';

describe('a file that claims twice the song\'s length', () => {
  it('is recognised when the player says about double (with some room for the way lengths are rounded)', () => {
    assert.equal(isDoubledDuration(360, 180), true);
    assert.equal(isDoubledDuration(362.4, 180), true);
    assert.equal(isDoubledDuration(DOUBLED_MIN * 200, 200), true);
    assert.equal(isDoubledDuration(DOUBLED_MAX * 200, 200), true);
  });

  it('is not when the two roughly agree, when the player says a little more, or far more (not the doubling pattern)', () => {
    for (const player of [180, 181, 185, 200, 250, 300, 540, 900]) assert.equal(isDoubledDuration(player, 180), false, String(player));
    assert.equal(isDoubledDuration(DOUBLED_MIN * 200 - 1, 200), false);
    assert.equal(isDoubledDuration(DOUBLED_MAX * 200 + 1, 200), false);
  });

  it('is never decided without a known song length, or for a short clip, or without a player length', () => {
    for (const known of [undefined, null, 0, -5, 10, 19.9]) assert.equal(isDoubledDuration(40, known as number | undefined), false, String(known));
    assert.equal(isDoubledDuration(0, 180), false);
    assert.equal(isDoubledDuration(Number.NaN, 180), false);
    assert.equal(isDoubledDuration(40, 20), true, 'a song of 20 s is the shortest that is judged');
  });
});

describe('the length the seek bar runs over', () => {
  it('is the song\'s own length when the file says double', () => {
    assert.equal(seekLength(360, 180), 180);
  });

  it('is what the player says, normally', () => {
    assert.equal(seekLength(181.5, 180), 181.5);
    assert.equal(seekLength(240, undefined), 240);
    assert.equal(seekLength(240, 0), 240);
  });

  it('is the song\'s length while the player has not reported one yet (0) – the bar must not shrink to one second', () => {
    assert.equal(seekLength(0, 215), 215);
    assert.equal(seekLength(0.4, 215), 215);
  });

  it('is never less than one second, so the slider always has a range', () => {
    assert.equal(seekLength(0, undefined), 1);
    assert.equal(seekLength(0, 0), 1);
    assert.equal(seekLength(0, -3), 1);
  });
});

describe('where a song really ends', () => {
  it('at its own length when the file says double; otherwise where the player says; unknown when neither is', () => {
    assert.equal(songEnd(360, 180), 180);
    assert.equal(songEnd(181, 180), 181);
    assert.equal(songEnd(0, 180), null);
    assert.equal(songEnd(0, undefined), null);
    assert.equal(songEnd(240, undefined), 240);
  });
});

describe('the slider\'s echo of a value we gave it', () => {
  it('a report that is (almost) the value given is an echo; a finger moves it further', () => {
    assert.equal(isEcho(42, 42), true);
    assert.equal(isEcho(42.4, 42), true);
    assert.equal(isEcho(41.3, 42), true);
    assert.equal(isEcho(42 + ECHO_TOLERANCE, 42), false);
    assert.equal(isEcho(60, 42), false);
    assert.equal(isEcho(0, 42), false);
  });
});
