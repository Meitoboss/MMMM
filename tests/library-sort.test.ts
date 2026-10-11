import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DATE_MEANING, SORT_LABEL, type SortKey, type SortTab, defaultSort, isRelease, parseSortPrefs, sortCaption, sortFor, sortOptions, validSort, withSort } from '../src/core/librarySort';
import { NO_YEAR, cleanYear, enrichYears } from '../src/core/releaseYears';
import type { SongItem } from '../src/core/types';
import type { Db } from '../src/db/driver';
import * as repo from '../src/db/repo';
import { migrate } from '../src/db/schema';
import { nodeDb } from './helpers/nodeDb';

const TABS: SortTab[] = ['songs', 'local', 'offline', 'liked', 'tags', 'history'];

describe('the choices of order for each list', () => {
  it('every list offers new → old, old → new and by name; all but the phone\'s own files also the release', () => {
    for (const tab of TABS) {
      const o = sortOptions(tab);
      assert.deepEqual(o.slice(0, 3), ['newest', 'oldest', 'title'], tab);
      assert.equal(o.includes('releaseNewest') && o.includes('releaseOldest'), tab !== 'local', tab);
    }
    for (const k of Object.keys(SORT_LABEL) as SortKey[]) assert.ok(SORT_LABEL[k].length > 1);
    for (const tab of TABS) assert.ok(DATE_MEANING[tab].length > 1);
  });

  it('saved songs start with the newest at the BOTTOM; the names lists stay A → Z; the others show the newest first', () => {
    assert.equal(defaultSort('offline'), 'oldest');
    assert.equal(defaultSort('songs'), 'title');
    assert.equal(defaultSort('tags'), 'title');
    for (const tab of ['local', 'liked', 'history'] as const) assert.equal(defaultSort(tab), 'newest');
    for (const tab of TABS) assert.ok(sortOptions(tab).includes(defaultSort(tab)), tab);
  });

  it('a choice that does not exist for a list falls back to its default', () => {
    assert.equal(validSort('offline', 'newest'), 'newest');
    assert.equal(validSort('local', 'releaseNewest'), 'newest', 'no release for the phone\'s own files');
    for (const v of [undefined, null, 5, 'nonsense', {}, '']) assert.equal(validSort('offline', v), 'oldest');
  });

  it('stored choices are read back checked, per list', () => {
    assert.deepEqual(parseSortPrefs({ offline: 'newest', liked: 'title', local: 'releaseOldest', songs: 'bogus', other: 'newest' }), { offline: 'newest', liked: 'title' });
    for (const bad of [null, undefined, 5, 'x', [], [1]]) assert.deepEqual(parseSortPrefs(bad), {});
    assert.equal(sortFor({}, 'offline'), 'oldest');
    assert.equal(sortFor({ offline: 'newest' }, 'offline'), 'newest');
    assert.deepEqual(withSort({ liked: 'title' }, 'offline', 'newest'), { liked: 'title', offline: 'newest' });
    assert.deepEqual(withSort({}, 'local', 'releaseNewest'), { local: 'newest' });
    assert.ok(isRelease('releaseNewest') && isRelease('releaseOldest') && !isRelease('newest'));
  });

  it('the line under the choices says which day the order follows, and where new saves go', () => {
    assert.equal(sortCaption('offline', 'oldest'), '保存した日が新しい曲が、下に並びます');
    assert.equal(sortCaption('offline', 'newest'), '保存した日が新しい曲が、上に並びます');
    assert.equal(sortCaption('liked', 'newest'), 'お気に入りにした日の新しい順です');
    assert.equal(sortCaption('history', 'oldest'), '最後に再生した日の古い順です');
    assert.equal(sortCaption('songs', 'title'), '曲名の順です');
    assert.match(sortCaption('liked', 'releaseNewest'), /発売年の、新しい順.*最後/);
  });
});

/* ---------------------------------------------------------------------------------------------- the database */
const song = (id: string, title: string, over: Partial<SongItem> = {}): SongItem => ({ kind: 'song', id, title, artists: [{ name: 'A' }], explicit: false, ...over });
const ids = (l: SongItem[]) => l.map((s) => s.id);

async function world(): Promise<Db> {
  const db = nodeDb();
  await migrate(db);
  return db;
}

describe('the Library lists in the order chosen', () => {
  it('songs: when a song came into the Library (its row keeps its place), or by name', async () => {
    const db = await world();
    for (const [id, title] of [['s3', 'Charlie'], ['s1', 'Alpha'], ['s2', 'Bravo']]) await repo.recordPlay(db, song(id, title), 5000);
    assert.deepEqual(ids(await repo.libraryList(db, 'songs', 'newest')), ['s2', 's1', 's3']);
    assert.deepEqual(ids(await repo.libraryList(db, 'songs', 'oldest')), ['s3', 's1', 's2']);
    assert.deepEqual(ids(await repo.libraryList(db, 'songs', 'title')), ['s1', 's2', 's3']);
    await repo.recordPlay(db, song('s3', 'Charlie'), 5000); // played again: it does not move
    assert.deepEqual(ids(await repo.libraryList(db, 'songs', 'oldest')), ['s3', 's1', 's2']);
  });

  it('songs that were only looked at (never played, liked or put in a playlist) are not in the list', async () => {
    const db = await world();
    await repo.upsertSong(db, song('seen', 'Seen'));
    await repo.recordPlay(db, song('played', 'Played'), 5000);
    assert.deepEqual(ids(await repo.libraryList(db, 'songs', 'title')), ['played']);
  });

  it('saved offline: by the day they were saved – oldest first puts the newest save at the bottom', async () => {
    const db = await world();
    for (const [id, title, at] of [['s1', 'Alpha', 1000], ['s2', 'Bravo', 3000], ['s3', 'Charlie', 2000]] as const) {
      await repo.addOffline(db, song(id, title), { fileName: `${id}.m4a` });
      await db.run('UPDATE Offline SET savedAt = ? WHERE songId = ?', [at, id]);
    }
    assert.deepEqual(ids(await repo.libraryList(db, 'offline', 'oldest')), ['s1', 's3', 's2']);
    assert.deepEqual(ids(await repo.libraryList(db, 'offline', 'newest')), ['s2', 's3', 's1']);
    assert.deepEqual(ids(await repo.libraryList(db, 'offline', 'title')), ['s1', 's2', 's3']);
    // the old function keeps its order (other parts of the app use it)
    assert.deepEqual(ids(await repo.offlineSongs(db)), ['s2', 's3', 's1']);
  });

  it('a song saved again moves to the newest place', async () => {
    const db = await world();
    for (const [id, at] of [['a', 1000], ['b', 2000]] as const) {
      await repo.addOffline(db, song(id, id), { fileName: `${id}.m4a` });
      await db.run('UPDATE Offline SET savedAt = ? WHERE songId = ?', [at, id]);
    }
    await repo.addOffline(db, song('a', 'a'), { fileName: 'a.m4a' }); // saved again: "now"
    assert.deepEqual(ids(await repo.libraryList(db, 'offline', 'oldest')), ['b', 'a']);
  });

  it('liked: by the day of the like; history: by the last play; local files: by the day they were imported', async () => {
    const db = await world();
    for (const [id, title, liked, played, added] of [['x1', 'Xa', 100, 900, 50], ['x2', 'Xb', 300, 700, 70], ['x3', 'Xc', 200, 800, 60]] as const) {
      await repo.recordPlay(db, song(id, title), 5000);
      await db.run('UPDATE Song SET likedAt = ? WHERE id = ?', [liked, id]);
      await db.run('UPDATE Event SET timestamp = ? WHERE songId = ?', [played, id]);
      await db.run('INSERT INTO LocalFile (songId, fileName, size, addedAt) VALUES (?,?,?,?)', [id, `${id}.mp3`, 1, added]);
    }
    assert.deepEqual(ids(await repo.libraryList(db, 'liked', 'newest')), ['x2', 'x3', 'x1']);
    assert.deepEqual(ids(await repo.libraryList(db, 'liked', 'oldest')), ['x1', 'x3', 'x2']);
    assert.deepEqual(ids(await repo.libraryList(db, 'history', 'newest')), ['x1', 'x3', 'x2']);
    assert.deepEqual(ids(await repo.libraryList(db, 'history', 'oldest')), ['x2', 'x3', 'x1']);
    assert.deepEqual(ids(await repo.libraryList(db, 'local', 'newest')), ['x2', 'x3', 'x1']);
    assert.deepEqual(ids(await repo.libraryList(db, 'local', 'oldest')), ['x1', 'x3', 'x2']);
  });

  it('history: only the most recent songs are taken (the limit), THEN ordered', async () => {
    const db = await world();
    for (let i = 1; i <= 5; i++) {
      await repo.recordPlay(db, song(`h${i}`, `Song ${6 - i}`), 5000); // titles: Song 5 … Song 1
      await db.run('UPDATE Event SET timestamp = ? WHERE songId = ?', [i * 100, `h${i}`]);
    }
    assert.deepEqual(ids(await repo.libraryList(db, 'history', 'oldest', { historyLimit: 3 })), ['h3', 'h4', 'h5']);
    assert.deepEqual(ids(await repo.libraryList(db, 'history', 'title', { historyLimit: 3 })), ['h5', 'h4', 'h3']);
  });

  it('tags: the songs of the chosen tags (any / all), in the order chosen', async () => {
    const db = await world();
    const t1 = await repo.createTag(db, 'rock');
    const t2 = await repo.createTag(db, 'live');
    for (const [id, title] of [['t1', 'Zed'], ['t2', 'Mid'], ['t3', 'Abe']]) await repo.recordPlay(db, song(id, title), 5000);
    for (const [s, t] of [['t1', t1], ['t2', t1], ['t3', t1], ['t1', t2], ['t3', t2]] as const) await db.run('INSERT INTO SongTag (songId, tagId) VALUES (?,?)', [s, t]);
    assert.deepEqual(ids(await repo.libraryList(db, 'tags', 'title', { tagIds: [t1], tagMode: 'any' })), ['t3', 't2', 't1']);
    assert.deepEqual(ids(await repo.libraryList(db, 'tags', 'oldest', { tagIds: [t1], tagMode: 'any' })), ['t1', 't2', 't3']);
    assert.deepEqual(ids(await repo.libraryList(db, 'tags', 'newest', { tagIds: [t1, t2], tagMode: 'all' })), ['t3', 't1']);
    assert.deepEqual(await repo.libraryList(db, 'tags', 'title', { tagIds: [], tagMode: 'any' }), []);
  });

  it('release order: by the first year of the song\'s album; songs with no known year (or marked as having none) come LAST in both directions', async () => {
    const db = await world();
    const cases: [string, string, string | null, string | null][] = [
      ['r1', 'Alpha', 'MPREb_1', '2010'],
      ['r2', 'Bravo', 'MPREb_2', '2020'],
      ['r3', 'Charlie', null, null], // no album at all
      ['r4', 'Delta', 'MPREb_4', NO_YEAR], // looked up: the album has no year
      ['r5', 'Echo', 'MPREb_5', '1999'],
      ['r6', 'Foxtrot', 'MPREb_6', null], // album known, year never looked up
    ];
    for (const [id, title, album, year] of cases) {
      await repo.recordPlay(db, song(id, title, album ? { album: { id: album, name: `Album ${album}` } } : {}), 5000);
      if (album && year !== null) await repo.setAlbumYear(db, album, year);
    }
    assert.deepEqual(ids(await repo.libraryList(db, 'songs', 'releaseNewest')), ['r2', 'r1', 'r5', 'r3', 'r4', 'r6']);
    assert.deepEqual(ids(await repo.libraryList(db, 'songs', 'releaseOldest')), ['r5', 'r1', 'r2', 'r3', 'r4', 'r6']);
  });

  it('a song on several albums uses the FIRST year (the original release, not a later compilation)', async () => {
    const db = await world();
    await repo.recordPlay(db, song('m1', 'Hit', { album: { id: 'MPREb_orig', name: 'Original' } }), 5000);
    await repo.recordPlay(db, song('m2', 'Other', { album: { id: 'MPREb_o2', name: 'Other' } }), 5000);
    await db.run("INSERT INTO Album (id, title, timestamp) VALUES ('MPREb_best', 'Best of', 1)");
    await db.run("INSERT INTO SongAlbumMap (songId, albumId, position) VALUES ('m1', 'MPREb_best', NULL)");
    await repo.setAlbumYear(db, 'MPREb_orig', '1985');
    await repo.setAlbumYear(db, 'MPREb_best', '2015');
    await repo.setAlbumYear(db, 'MPREb_o2', '2000');
    assert.deepEqual(ids(await repo.libraryList(db, 'songs', 'releaseOldest')), ['m1', 'm2']);
  });

  it('release order works in the other lists too (offline here)', async () => {
    const db = await world();
    for (const [id, album, year, at] of [['o1', 'MPREb_a', '2005', 1], ['o2', 'MPREb_b', '2001', 2]] as const) {
      await repo.addOffline(db, song(id, id, { album: { id: album, name: album } }), { fileName: `${id}.m4a` });
      await db.run('UPDATE Offline SET savedAt = ? WHERE songId = ?', [at, id]);
      await repo.setAlbumYear(db, album, year);
    }
    assert.deepEqual(ids(await repo.libraryList(db, 'offline', 'releaseOldest')), ['o2', 'o1']);
    assert.deepEqual(ids(await repo.libraryList(db, 'offline', 'releaseNewest')), ['o1', 'o2']);
  });

  it('the albums still to be looked up: only the albums of songs in the Library, only real album ids, only if the year was never asked', async () => {
    const db = await world();
    await repo.recordPlay(db, song('p1', 'P1', { album: { id: 'MPREb_need', name: 'Need' } }), 5000);
    await repo.recordPlay(db, song('p2', 'P2', { album: { id: 'MPREb_done', name: 'Done' } }), 5000);
    await repo.recordPlay(db, song('p3', 'P3', { album: { id: 'MPREb_none', name: 'None' } }), 5000);
    await repo.recordPlay(db, song('p4', 'P4', { album: { id: 'localalbum', name: 'Not a YT id' } }), 5000);
    await repo.upsertSong(db, song('seen', 'Seen', { album: { id: 'MPREb_unused', name: 'Unused' } })); // only looked at
    await repo.setAlbumYear(db, 'MPREb_done', '2001');
    await repo.setAlbumYear(db, 'MPREb_none', NO_YEAR);
    assert.deepEqual(await repo.albumsMissingYear(db), ['MPREb_need']);
    assert.deepEqual(await repo.albumsMissingYear(db, 0), []);
  });

  it('setAlbumYear only touches the album asked for, and an unknown album is ignored', async () => {
    const db = await world();
    await repo.recordPlay(db, song('q1', 'Q1', { album: { id: 'MPREb_q', name: 'Q' } }), 5000);
    await repo.setAlbumYear(db, 'MPREb_q', '2012');
    await repo.setAlbumYear(db, 'MPREb_missing', '2020');
    assert.equal((await db.first<{ year: string }>("SELECT year FROM Album WHERE id = 'MPREb_q'"))?.year, '2012');
    assert.equal(await db.first("SELECT 1 AS x FROM Album WHERE id = 'MPREb_missing'"), null);
  });
});

/* ---------------------------------------------------------------------------------------------- finding out the years */
describe('finding out the release years', () => {
  it('a year is taken out of whatever the album page says', () => {
    assert.equal(cleanYear('2019'), '2019');
    assert.equal(cleanYear('2019-05-01'), '2019');
    assert.equal(cleanYear('May 2019'), '2019');
    assert.equal(cleanYear('1985'), '1985');
    for (const v of [undefined, null, '', 'unknown', 5, '12345', '1850', '3021']) assert.equal(cleanYear(v), null, String(v));
  });

  const run = (years: Record<string, string | null | Error>, extra: Partial<Parameters<typeof enrichYears>[0]> = {}) => {
    const saved: Record<string, string> = {};
    const progress: [number, number][] = [];
    const promise = enrichYears({
      ids: Object.keys(years),
      fetchYear: async (id) => { const y = years[id]; if (y instanceof Error) throw y; return y; },
      save: async (id, y) => { saved[id] = y; },
      isCancelled: () => false,
      onProgress: (d, t) => progress.push([d, t]),
      ...extra,
    });
    return { promise, saved, progress };
  };

  it('every album is asked about once; the year is saved; an album without a year is saved as "has none"', async () => {
    const r = run({ a: '2001', b: null, c: 'May 1999', d: 'garbage' });
    const res = await r.promise;
    assert.deepEqual(r.saved, { a: '2001', b: NO_YEAR, c: '1999', d: NO_YEAR });
    assert.deepEqual(res, { found: 2, none: 2, failed: 0, stopped: 'done' });
    assert.equal(r.progress.length, 4);
    assert.deepEqual(r.progress.at(-1), [4, 4]);
  });

  it('a failing album is skipped (and asked about again another day, since nothing is saved for it)', async () => {
    const r = run({ a: '2001', b: new Error('HTTP 500'), c: '2003' });
    const res = await r.promise;
    assert.deepEqual(r.saved, { a: '2001', c: '2003' });
    assert.deepEqual(res, { found: 2, none: 0, failed: 1, stopped: 'done' });
  });

  it('when the network is down it stops after a few failures in a row (it does not try hundreds)', async () => {
    const years: Record<string, Error> = {};
    for (let i = 0; i < 40; i++) years[`x${i}`] = new Error('offline');
    let asked = 0;
    const res = await enrichYears({ ids: Object.keys(years), fetchYear: async () => { asked++; throw new Error('offline'); }, save: async () => undefined, isCancelled: () => false, concurrency: 1, maxFailuresInRow: 5 });
    assert.equal(res.stopped, 'network');
    assert.equal(asked, 5);
    assert.equal(res.failed, 5);
  });

  it('one success in between starts the count again', async () => {
    const seq = [new Error('x'), new Error('x'), '2000', new Error('x'), new Error('x'), '2001', '2002'];
    let i = 0;
    const res = await enrichYears({ ids: seq.map((_, k) => `a${k}`), fetchYear: async () => { const v = seq[i++]; if (v instanceof Error) throw v; return v; }, save: async () => undefined, isCancelled: () => false, concurrency: 1, maxFailuresInRow: 3 });
    assert.equal(res.stopped, 'done');
    assert.equal(res.found, 3);
  });

  it('can be cancelled: what was saved stays, the rest is not asked', async () => {
    let calls = 0;
    const saved: string[] = [];
    const res = await enrichYears({ ids: ['a', 'b', 'c', 'd', 'e'], fetchYear: async () => '2000', save: async (id) => void saved.push(id), isCancelled: () => calls++ >= 3, concurrency: 1 });
    assert.equal(res.stopped, 'cancelled');
    assert.deepEqual(saved, ['a', 'b', 'c']);
  });

  it('several albums are asked at the same time (not more than the limit); nothing to do is fine', async () => {
    let running = 0;
    let most = 0;
    const res = await enrichYears({ ids: Array.from({ length: 12 }, (_, i) => `a${i}`), fetchYear: async () => { running++; most = Math.max(most, running); await new Promise((r) => setTimeout(r, 5)); running--; return '2000'; }, save: async () => undefined, isCancelled: () => false, concurrency: 3 });
    assert.equal(res.found, 12);
    assert.equal(most, 3);
    assert.deepEqual(await enrichYears({ ids: [], fetchYear: async () => '2000', save: async () => undefined, isCancelled: () => false }), { found: 0, none: 0, failed: 0, stopped: 'done' });
  });
});
