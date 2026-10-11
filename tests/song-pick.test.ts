import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type PickItem, chosenIds, filterItems, selectAll, setMany, summary, toggle } from '../src/core/songPick';

const items: PickItem[] = [
  { id: 'a', title: 'Blue Moon', artist: 'Frank', bytes: 4_000_000 },
  { id: 'b', title: '青い月', artist: '山田太郎', bytes: 3_000_000 },
  { id: 'c', title: 'Red Sun', artist: 'Frank', bytes: 5_000_000 },
  { id: 'd', title: 'ＡＢＣ', artist: 'Ｘｙｚ', bytes: 1_000_000 },
];

describe('choosing the songs for the file', () => {
  it('everything is chosen at first', () => {
    assert.deepEqual([...selectAll(items)], ['a', 'b', 'c', 'd']);
    assert.deepEqual([...selectAll([])], []);
  });

  it('a tap flips one song; the old selection is not changed', () => {
    const all = selectAll(items);
    const one = toggle(all, 'b');
    assert.deepEqual([...one], ['a', 'c', 'd']);
    assert.equal(all.size, 4);
    assert.deepEqual([...toggle(one, 'b')].sort(), ['a', 'b', 'c', 'd']);
    assert.deepEqual([...toggle(new Set(), 'z')], ['z']);
  });

  it('select / deselect many (the ones a search shows) leaves the others as they were', () => {
    const none = new Set<string>();
    assert.deepEqual([...setMany(none, ['a', 'c'], true)], ['a', 'c']);
    assert.deepEqual([...setMany(selectAll(items), ['a', 'c'], false)].sort(), ['b', 'd']);
    assert.deepEqual([...setMany(new Set(['b']), ['a'], true)].sort(), ['a', 'b']);
    assert.equal(selectAll(items).size, 4);
  });

  it('the count and the size of what is chosen (an id that is not in the list does not count)', () => {
    assert.deepEqual(summary(items, selectAll(items)), { count: 4, bytes: 13_000_000 });
    assert.deepEqual(summary(items, new Set(['a', 'c'])), { count: 2, bytes: 9_000_000 });
    assert.deepEqual(summary(items, new Set(['zzz'])), { count: 0, bytes: 0 });
    assert.deepEqual(summary([], new Set(['a'])), { count: 0, bytes: 0 });
  });

  it('the search looks in the title and the artist; every word must be found; case and width of letters do not matter', () => {
    assert.deepEqual(filterItems(items, 'frank').map((i) => i.id), ['a', 'c']);
    assert.deepEqual(filterItems(items, 'FRANK blue').map((i) => i.id), ['a']);
    assert.deepEqual(filterItems(items, '青い').map((i) => i.id), ['b']);
    assert.deepEqual(filterItems(items, '山田').map((i) => i.id), ['b']);
    assert.deepEqual(filterItems(items, 'abc').map((i) => i.id), ['d'], 'full-width letters match half-width ones');
    assert.deepEqual(filterItems(items, 'xyz').map((i) => i.id), ['d']);
    assert.deepEqual(filterItems(items, 'nothing like this'), []);
    assert.equal(filterItems(items, '   '), items, 'a blank search shows everything');
    assert.equal(filterItems(items, ''), items);
  });

  it('the ids handed on are in the order of the list, and only those chosen', () => {
    assert.deepEqual(chosenIds(items, new Set(['c', 'a'])), ['a', 'c']);
    assert.deepEqual(chosenIds(items, new Set()), []);
    assert.deepEqual(chosenIds(items, new Set(['x'])), []);
  });
});
