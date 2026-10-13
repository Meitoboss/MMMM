import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TASTE_LIMIT, TASTE_MAX_AGE_MS, hiResCover, isFresh, mixRadios } from '../src/core/taste';
import type { SongItem } from '../src/core/types';

const song = (id: string): SongItem => ({ kind: 'song', id, title: `T ${id}`, artists: [{ name: 'A' }], explicit: false });

describe('taste mix', () => {
  it('takes one song from each radio in turn, without repeats, seeds or songs on the phone', () => {
    const radios = [
      [song('a1'), song('s2'), song('b1'), song('a2')],
      [song('a1'), song('c1'), song('local:x'), song('c2')],
    ];
    const mix = mixRadios(['s1', 's2'], radios);
    assert.deepEqual(mix.map((s) => s.id), ['a1', 'c1', 'b1', 'a2', 'c2']);
  });

  it('stops at the limit', () => {
    const many = [Array.from({ length: 50 }, (_, i) => song(`x${i}`))];
    assert.equal(mixRadios([], many).length, TASTE_LIMIT);
  });

  it('is empty when there are no radios', () => {
    assert.deepEqual(mixRadios(['s1'], []), []);
  });
});

describe('hi-res cover', () => {
  it('raises the size of a Google-hosted cover', () => {
    assert.equal(hiResCover('https://lh3.googleusercontent.com/abc=w120-h120-l90-rj', 900), 'https://lh3.googleusercontent.com/abc=w900-h900-l90-rj');
  });

  it('leaves other addresses and missing covers as they are', () => {
    assert.equal(hiResCover('https://i.ytimg.com/vi/x/hqdefault.jpg', 900), 'https://i.ytimg.com/vi/x/hqdefault.jpg');
    assert.equal(hiResCover(undefined, 900), undefined);
  });
});

describe('saved mix age', () => {
  it('is fresh for a day and not in the future', () => {
    const now = 1_000_000_000_000;
    assert.equal(isFresh(now - 1000, now), true);
    assert.equal(isFresh(now - TASTE_MAX_AGE_MS, now), false);
    assert.equal(isFresh(now + 1000, now), false);
  });
});
