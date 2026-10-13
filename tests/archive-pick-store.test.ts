import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { PickSession } from '../src/core/pickSession';
import type { PickItem } from '../src/core/songPick';

const items: PickItem[] = [
  { id: 'a', title: 'A', artist: 'X', bytes: 1 },
  { id: 'b', title: 'B', artist: 'Y', bytes: 2 },
  { id: 'c', title: 'C', artist: 'Z', bytes: 3 },
];
let session = new PickSession();
const st = () => session;
const pickSongs = (list: PickItem[], open: () => void) => {
  const answer = session.begin(list);
  open();
  return answer;
};

describe('the choice of songs, between Settings and the screen', () => {
  it('every change is reported to the screen (the store that draws it)', () => {
    const seen: boolean[] = [];
    const s = new PickSession((x) => seen.push(x.active));
    void s.begin(items);
    s.toggle('a');
    s.confirm();
    assert.deepEqual(seen, [true, true, false]);
  });

  beforeEach(() => { session = new PickSession(); });

  it('begins with everything chosen, and shows the screen after the list is ready', async () => {
    let order = '';
    const answer = pickSongs(items, () => { order += st().state.active ? 'open-after-ready' : 'open-too-early'; });
    assert.equal(order, 'open-after-ready');
    assert.deepEqual([...st().state.selected], ['a', 'b', 'c']);
    st().cancel();
    assert.equal(await answer, null);
  });

  it('"決定" answers with the chosen ids, in the order of the list', async () => {
    const answer = pickSongs(items, () => undefined);
    st().toggle('b');
    st().toggle('b');
    st().toggle('a');
    st().confirm();
    assert.deepEqual(await answer, ['b', 'c']);
    assert.equal(st().state.active, false);
  });

  it('leaving the screen any other way answers null (nothing is exported)', async () => {
    const answer = pickSongs(items, () => undefined);
    st().cancel();
    assert.equal(await answer, null);
    st().cancel(); // again: harmless
  });

  it('nothing chosen is a valid answer (an empty list), not a cancel', async () => {
    const answer = pickSongs(items, () => undefined);
    st().setMany(['a', 'b', 'c'], false);
    st().confirm();
    assert.deepEqual(await answer, []);
  });

  it('answering twice does nothing the second time', async () => {
    const answer = pickSongs(items, () => undefined);
    st().confirm();
    st().confirm();
    st().cancel();
    assert.deepEqual(await answer, ['a', 'b', 'c']);
  });

  it('a new choice while one is still open gives up the old one (null) and starts again with everything chosen', async () => {
    const first = pickSongs(items, () => undefined);
    st().toggle('a');
    const second = pickSongs(items.slice(0, 2), () => undefined);
    assert.equal(await first, null);
    assert.deepEqual([...st().state.selected], ['a', 'b']);
    st().confirm();
    assert.deepEqual(await second, ['a', 'b']);
  });

  it('an empty list of songs is fine', async () => {
    const answer = pickSongs([], () => undefined);
    st().confirm();
    assert.deepEqual(await answer, []);
  });
});
