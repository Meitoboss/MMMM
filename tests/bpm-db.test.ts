import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { type SmartRules, describeRules, emptyRules, sanitizeRules } from '../src/core/smart';
import type { SongItem } from '../src/core/types';
import type { Db } from '../src/db/driver';
import * as repo from '../src/db/repo';
import { SCHEMA_VERSION, migrate } from '../src/db/schema';
import { nodeDb } from './helpers/nodeDb';

const song = (id: string, title = `T ${id}`): SongItem => ({ kind: 'song', id, title, artists: [{ name: 'A' }], explicit: false });
const rules = (over: Partial<SmartRules>): SmartRules => ({ ...emptyRules(), ...over });
const ids = async (db: Db, r: SmartRules) => (await repo.smartSongs(db, r)).map((s) => s.id);

describe('the tempo of a song in the database', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('is saved, read back, replaced and removed', async () => {
    assert.equal(await repo.bpmOf(db, 'a'), null);
    assert.deepEqual(await repo.setBpm(db, song('a'), { bpm: 128 }), { bpm: 128 });
    assert.deepEqual(await repo.bpmOf(db, 'a'), { bpm: 128 });
    assert.deepEqual(await repo.setBpm(db, song('a'), { bpm: 127.5, anchor: 12.34 }), { bpm: 127.5, anchor: 12.34 });
    assert.deepEqual(await repo.bpmOf(db, 'a'), { bpm: 127.5, anchor: 12.34 });
    assert.equal(await repo.setBpm(db, song('a'), null), null);
    assert.equal(await repo.bpmOf(db, 'a'), null);
  });

  it('a value that is not a usable BPM is refused and nothing changes', async () => {
    await repo.setBpm(db, song('a'), { bpm: 120 });
    for (const bad of [0, 29, 301, Number.NaN, Number.POSITIVE_INFINITY]) await assert.rejects(() => repo.setBpm(db, song('a'), { bpm: bad }), /30〜300/, String(bad));
    assert.deepEqual(await repo.bpmOf(db, 'a'), { bpm: 120 });
  });

  it('a damaged beat position is dropped, the BPM is kept', async () => {
    assert.deepEqual(await repo.setBpm(db, song('a'), { bpm: 120, anchor: -3 }), { bpm: 120 });
    assert.deepEqual(await repo.setBpm(db, song('a'), { bpm: 120, anchor: Number.NaN }), { bpm: 120 });
  });

  it('a song that was not known yet is added with it; the tempo goes when the song goes', async () => {
    await repo.setBpm(db, song('new', 'Brand new'), { bpm: 100 });
    assert.equal((await repo.getSong(db, 'new'))?.title, 'Brand new');
    await db.run('DELETE FROM Song WHERE id = ?', ['new']);
    assert.equal(await repo.bpmOf(db, 'new'), null);
  });

  it('a row with a nonsense value in the file is read as "no tempo"', async () => {
    await repo.upsertSong(db, song('x'));
    await db.run('INSERT INTO SongBpm (songId, bpm, anchor) VALUES (?,?,?)', ['x', 5, null]);
    assert.equal(await repo.bpmOf(db, 'x'), null);
  });

  it('the migration is additive and can run again; the version is recorded', async () => {
    await repo.setBpm(db, song('a'), { bpm: 120 });
    await migrate(db);
    assert.deepEqual(await repo.bpmOf(db, 'a'), { bpm: 120 });
    assert.equal((await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 24);
  });
});

describe('smart playlists by tempo', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
    for (const [id, bpm] of [['slow', 70], ['mid', 120], ['edge', 130], ['fast', 174]] as const) await repo.setBpm(db, song(id, id), { bpm });
    await repo.upsertSong(db, song('none', 'none'));
    await repo.toggleLike(db, song('mid', 'mid'));
  });

  it('a range includes both ends and leaves out songs without a tempo', async () => {
    assert.deepEqual((await ids(db, rules({ rules: [{ field: 'bpm', min: 120, max: 130 }], sort: 'title' }))).sort(), ['edge', 'mid']);
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'bpm', min: 175, max: 200 }] })), []);
    assert.equal((await ids(db, rules({ rules: [{ field: 'bpm', min: 30, max: 300 }] }))).length, 4, 'every song that HAS a tempo – not "none"');
  });

  it('sorted by tempo, slowest first, songs without a tempo last', async () => {
    assert.deepEqual(await ids(db, rules({ sort: 'bpm' })), ['slow', 'mid', 'edge', 'fast', 'none']);
  });

  it('combines with other rules', async () => {
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'bpm', min: 100, max: 140 }, { field: 'liked', value: true }] })), ['mid']);
    assert.deepEqual((await ids(db, rules({ match: 'any', rules: [{ field: 'bpm', min: 160, max: 180 }, { field: 'liked', value: true }], sort: 'title' }))).sort(), ['fast', 'mid']);
  });

  it('a stored rule is checked: swapped ends are put right, nonsense is dropped', () => {
    assert.deepEqual(sanitizeRules({ rules: [{ field: 'bpm', min: 130, max: 120 }] }).rules, [{ field: 'bpm', min: 120, max: 130 }]);
    assert.deepEqual(sanitizeRules({ rules: [{ field: 'bpm', min: 'a', max: 120 }, { field: 'bpm', min: 10 }, { field: 'bpm', min: 1000, max: 5000 }] }).rules, [{ field: 'bpm', min: 300, max: 300 }]);
    assert.equal(sanitizeRules({ sort: 'bpm' }).sort, 'bpm');
  });

  it('is described in words', () => {
    assert.equal(describeRules(rules({ rules: [{ field: 'bpm', min: 120, max: 130 }, { field: 'liked', value: true }] })), 'BPM 120〜130・お気に入り');
  });

  it('a list that already existed (saved before BPM existed) still works', async () => {
    await repo.saveSmartPlaylist(db, { name: '古いもの', rules: rules({ rules: [{ field: 'liked', value: true }] }) });
    const [p] = await repo.smartPlaylists(db);
    assert.deepEqual(await ids(db, p.rules), ['mid']);
  });
});
