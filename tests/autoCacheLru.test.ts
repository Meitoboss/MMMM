import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pickEvictions } from '../src/core/autoCacheLru';

const e = (id: string, bytes: number, at: number) => ({ id, file: `${id}.m4a`, bytes, at });

test('nothing is removed while the cache fits both limits', () => {
  assert.deepEqual(pickEvictions([e('a', 10, 1), e('b', 10, 2)], 100, 5), []);
});

test('the least recently played go first, until the size fits', () => {
  const got = pickEvictions([e('new', 60, 3), e('old', 60, 1), e('mid', 60, 2)], 130, 10);
  assert.deepEqual(got.map((x) => x.id), ['old']);
});

test('too many songs also make room, oldest first', () => {
  const got = pickEvictions([e('a', 1, 1), e('b', 1, 2), e('c', 1, 3)], 100, 1);
  assert.deepEqual(got.map((x) => x.id), ['a', 'b']);
});
