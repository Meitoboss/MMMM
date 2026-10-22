import assert from 'node:assert/strict';
import { test } from 'node:test';

import { widgetPayload } from '../src/core/widget';

test('no 集中 sound: the widget shows nothing', () => {
  assert.deepEqual(JSON.parse(widgetPayload(null)), { active: false, title: '', hz: 0, playing: false });
});

test('a playing 集中 sound: its name, beat and play state', () => {
  assert.deepEqual(JSON.parse(widgetPayload({ title: '光と踊る', hz: 8, playing: true })), { active: true, title: '光と踊る', hz: 8, playing: true });
});

test('the beat is a whole number of Hz, and a paused sound is marked as paused', () => {
  const p = JSON.parse(widgetPayload({ title: '広い野原', hz: 19.6, playing: false }));
  assert.equal(p.hz, 20);
  assert.equal(p.playing, false);
});
