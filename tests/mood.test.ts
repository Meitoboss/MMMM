import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DIAL_OPTIONS, DIAL_STEP, MOODS, TIME_OPTION, angleFor, matchTagIds, nowHours, selectedIndex, timeLabel } from '../src/core/mood';

describe('mood dial', () => {
  it('starts with the time of day, then the feelings', () => {
    assert.equal(DIAL_OPTIONS[0], TIME_OPTION);
    assert.equal(DIAL_OPTIONS.length, MOODS.length + 1);
  });

  it('turns to the nearest option and back to the same option', () => {
    for (let i = 0; i < DIAL_OPTIONS.length; i += 1) {
      assert.equal(selectedIndex(angleFor(i)), i);
      assert.equal(selectedIndex(angleFor(i) + DIAL_STEP * 0.3), i);
      assert.equal(selectedIndex(angleFor(i) - DIAL_STEP * 0.3), i);
    }
    assert.equal(selectedIndex(-DIAL_STEP * 0.6), 1);
    assert.equal(selectedIndex(DIAL_STEP * 0.6), DIAL_OPTIONS.length - 1);
  });

  it('matches tags by a word in their name, ignoring case', () => {
    const tags = [
      { id: 1, name: '元気が出る' },
      { id: 2, name: 'Chill・落ち着く' },
      { id: 3, name: '作業用' },
    ];
    assert.deepEqual(matchTagIds(tags, MOODS[0]), [1]);
    assert.deepEqual(matchTagIds(tags, MOODS[1]), [2]);
    assert.deepEqual(matchTagIds(tags, MOODS[2]), []);
  });

  it('uses the hours and label of the current time of day', () => {
    const night = new Date(2026, 9, 14, 23, 0);
    assert.ok(nowHours(night).includes(23));
    assert.equal(timeLabel(night), '今（夜）');
  });
});
