import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizedVolume } from '../src/core/loudness';
import { MAX_RESUME_QUEUE, parseResume, serializeResume, startPosition } from '../src/core/resume';
import { groupResults, toRows } from '../src/core/searchGroups';
import type { MusicItem, SongItem } from '../src/core/types';

const song = (id: string): SongItem => ({ kind: 'song', id, title: `T ${id}`, artists: [{ name: 'A' }], explicit: false, durationSec: 200 });

describe('volume normalisation', () => {
  it('turns loud songs down, by the amount YouTube reports', () => {
    assert.ok(Math.abs(normalizedVolume(6, 'standard') - 0.501) < 0.01); // 6 dB down
    assert.ok(Math.abs(normalizedVolume(3, 'standard') - 0.708) < 0.01);
    assert.ok(Math.abs(normalizedVolume(6, 'light') - 0.708) < 0.01); // half the strength
  });
  it('never turns a quiet song up (a phone cannot go past 100 %)', () => {
    assert.equal(normalizedVolume(-4.5, 'standard'), 1);
    assert.equal(normalizedVolume(0, 'standard'), 1);
  });
  it('off, unknown or unbelievable values leave the volume alone', () => {
    assert.equal(normalizedVolume(8, 'off'), 1);
    assert.equal(normalizedVolume(undefined, 'standard'), 1);
    assert.equal(normalizedVolume(null, 'standard'), 1);
    assert.equal(normalizedVolume(Number.NaN, 'standard'), 1);
    assert.equal(normalizedVolume(80, 'standard'), 1);
  });
  it('is never silent', () => {
    assert.equal(normalizedVolume(25, 'standard'), 0.1);
  });
});

describe('continue where you left off', () => {
  const base = { queue: ['a', 'b', 'c', 'd'].map(song), index: 2, position: 61.7, repeat: 'all' as const, shuffle: true };

  it('saves and restores the queue, the song, the position and the modes', () => {
    const r = parseResume(serializeResume(base));
    assert.ok(r);
    assert.deepEqual(r.queue.map((s) => s.id), ['a', 'b', 'c', 'd']);
    assert.equal(r.index, 2);
    assert.equal(r.position, 62);
    assert.equal(r.repeat, 'all');
    assert.equal(r.shuffle, true);
  });

  it('saves only what is needed of a song', () => {
    const fat = { ...song('x'), setVideoId: 'SVID', extra: 'junk' } as unknown as SongItem;
    const saved = JSON.parse(serializeResume({ ...base, queue: [fat], index: 0 }));
    assert.equal('setVideoId' in saved.queue[0], false);
    assert.equal('extra' in saved.queue[0], false);
    assert.equal(saved.queue[0].id, 'x');
  });

  it('a very long queue is cut to a window around the current song', () => {
    const queue = Array.from({ length: 1000 }, (_, i) => song(`s${i}`));
    const r = parseResume(serializeResume({ ...base, queue, index: 700 }));
    assert.ok(r);
    assert.equal(r.queue.length, MAX_RESUME_QUEUE);
    assert.equal(r.queue[r.index].id, 's700', 'still the same song');
    const early = parseResume(serializeResume({ ...base, queue, index: 2 }));
    assert.equal(early?.queue[early.index].id, 's2');
    const late = parseResume(serializeResume({ ...base, queue, index: 999 }));
    assert.equal(late?.queue[late.index].id, 's999');
  });

  it('damaged or foreign data is refused, never thrown', () => {
    for (const bad of [null, undefined, '', 'not json', '{}', '[]', '{"v":2,"queue":[]}', '{"v":1,"queue":"x"}', '{"v":1,"queue":[]}', '{"v":1,"queue":[{"x":1}]}']) {
      assert.equal(parseResume(bad as string), null, String(bad));
    }
  });

  it('unreadable entries are dropped and the index still points at the same song', () => {
    const raw = JSON.stringify({ v: 1, queue: [{ junk: true }, song('a'), 7, song('b')], index: 3, position: 10, repeat: 'x', shuffle: 'yes' });
    const r = parseResume(raw);
    assert.ok(r);
    assert.deepEqual(r.queue.map((s) => s.id), ['a', 'b']);
    assert.equal(r.queue[r.index].id, 'b');
    assert.equal(r.repeat, 'off');
    assert.equal(r.shuffle, false);
  });

  it('a bad index or position is repaired', () => {
    const r = parseResume(JSON.stringify({ v: 1, queue: [song('a'), song('b')], index: 99, position: -5 }));
    assert.equal(r?.index, 1);
    assert.equal(r?.position, 0);
    assert.equal(parseResume(JSON.stringify({ v: 1, queue: [song('a')], index: 'x', position: 'y' }))?.index, 0);
  });

  it('where to start: a barely started or nearly finished song starts from the beginning', () => {
    assert.equal(startPosition(61.7, 200), 61);
    assert.equal(startPosition(1, 200), 0);
    assert.equal(startPosition(197, 200), 0);
    assert.equal(startPosition(150, undefined), 150);
    assert.equal(startPosition(Number.NaN, 200), 0);
  });
});

describe('search results grouped by kind', () => {
  const video = { kind: 'video', id: 'v1', title: 'MV', artists: [], explicit: false } as unknown as MusicItem;
  const album = { kind: 'album', id: 'al1', title: 'Album', artists: [] } as unknown as MusicItem;
  const artist = { kind: 'artist', id: 'ar1', title: 'Artist' } as unknown as MusicItem;
  const playlist = { kind: 'playlist', id: 'p1', title: 'List' } as unknown as MusicItem;
  const mixed = [artist, song('s1'), album, video, song('s2'), playlist, video && ({ ...video, id: 'v2' } as MusicItem)];

  it('songs with songs, videos with videos, albums with albums – in a fixed order', () => {
    const groups = groupResults(mixed);
    assert.deepEqual(groups.map((g) => g.label), ['曲', 'ビデオ', 'アルバム', 'アーティスト', 'プレイリスト']);
    assert.deepEqual(groups[0].items.map((i) => i.id), ['s1', 's2']);
    assert.deepEqual(groups[1].items.map((i) => i.id), ['v1', 'v2']);
  });

  it('empty kinds get no header', () => {
    const groups = groupResults([song('s1'), album]);
    assert.deepEqual(groups.map((g) => g.kind), ['song', 'album']);
    assert.deepEqual(groupResults([]), []);
  });

  it('every group knows the filter that shows only that kind', () => {
    const f = Object.fromEntries(groupResults(mixed).map((g) => [g.kind, g.filter]));
    assert.deepEqual(f, { song: 'song', video: 'video', album: 'album', artist: 'artist', playlist: 'community_playlist' });
  });

  it('the flat list alternates a header with its items', () => {
    const rows = toRows(groupResults([song('s1'), song('s2'), album]));
    assert.deepEqual(rows.map((r) => (r.type === 'header' ? `# ${r.group.label}` : r.item.id)), ['# 曲', 's1', 's2', '# アルバム', 'al1']);
  });
});
