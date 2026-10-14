import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { partOfDay, sameDayBefore, PART_OF_DAY_HOURS } from '../src/core/homeMemory';

describe('same day in earlier years', () => {
  it('gives the same month and day, one range per year, in local time', () => {
    const now = new Date(2026, 9, 14, 15, 30);
    const [one, two] = sameDayBefore(now, [1, 2]);
    assert.equal(one.years, 1);
    assert.equal(new Date(one.start).getFullYear(), 2025);
    assert.equal(new Date(one.start).getMonth(), 9);
    assert.equal(new Date(one.start).getDate(), 14);
    assert.equal(new Date(one.end).getDate(), 15, 'the range ends at the next midnight');
    assert.equal(new Date(two.start).getFullYear(), 2024);
  });
});

describe('part of the day', () => {
  it('splits the day into four parts, and the hour lists match them', () => {
    assert.equal(partOfDay(6), 'morning');
    assert.equal(partOfDay(13), 'day');
    assert.equal(partOfDay(19), 'evening');
    assert.equal(partOfDay(23), 'night');
    assert.equal(partOfDay(2), 'night');
    for (const [part, hours] of Object.entries(PART_OF_DAY_HOURS)) {
      for (const h of hours) assert.equal(partOfDay(h), part, `hour ${h} should be ${part}`);
    }
  });
});
