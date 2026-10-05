import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';

import { DEFAULT_LIMIT, MAX_LIMIT, type SmartRules, buildSmartQuery, describeRules, emptyRules, sanitizeRules } from '../src/core/smart';
import type { SongItem } from '../src/core/types';
import type { Db, SqlValue } from '../src/db/driver';
import * as repo from '../src/db/repo';
import { migrate } from '../src/db/schema';

function nodeDb(): Db {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  let depth = 0;
  return {
    exec: async (sql) => void raw.exec(sql),
    run: async (sql, p: SqlValue[] = []) => {
      const r = raw.prepare(sql).run(...p);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    all: async <T,>(sql: string, p: SqlValue[] = []) => raw.prepare(sql).all(...p) as T[],
    first: async <T,>(sql: string, p: SqlValue[] = []) => (raw.prepare(sql).get(...p) as T | undefined) ?? null,
    transaction: async <T,>(fn: () => Promise<T>) => {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN');
      try {
        const r = await fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}

const DAY = 86_400_000;
const song = (id: string, title: string, artist: string): SongItem => ({ kind: 'song', id, title, artists: [{ name: artist }], explicit: false });
const rules = (over: Partial<SmartRules>): SmartRules => ({ ...emptyRules(), ...over });
const ids = async (db: Db, r: SmartRules) => (await repo.smartSongs(db, r)).map((s) => s.id);

/** a small library:
 *  a  liked, 5 plays, last played 2 days ago,  YouTube
 *  b  not liked, 1 play, last played 200 days ago
 *  c  liked, never played
 *  d  not liked, 12 plays, last played 40 days ago
 *  local:e  a file on the device, 3 plays yesterday */
async function library(db: Db) {
  const t = Date.now();
  for (const s of [song('a', 'Alpha_100%', 'King Gnu'), song('b', 'Beta', 'YOASOBI'), song('c', 'Gamma', 'King Gnu'), song('d', 'Delta', 'Ado'), song('local:e', 'Echo', 'ローカルファイル')]) await repo.upsertSong(db, s);
  await repo.toggleLike(db, song('a', 'Alpha_100%', 'King Gnu'));
  await repo.toggleLike(db, song('c', 'Gamma', 'King Gnu'));
  const play = (id: string, daysAgo: number) => db.run('INSERT INTO Event (songId, timestamp, playTime) VALUES (?,?,?)', [id, t - daysAgo * DAY, 60000]);
  for (let i = 0; i < 4; i++) await play('a', 30 + i);
  await play('a', 2);
  await play('b', 200);
  for (let i = 0; i < 11; i++) await play('d', 60 + i);
  await play('d', 40);
  for (let i = 0; i < 3; i++) await play('local:e', 1);
}

describe('smart playlists', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
    await library(db);
  });

  it('no rules: every song, newest play first', async () => {
    const all = await ids(db, rules({}));
    assert.equal(all.length, 5);
    assert.deepEqual(all.slice(0, 2), ['local:e', 'a'], 'most recently played first');
    assert.equal(all.at(-1), 'c', 'never played last');
  });

  it('liked / not liked', async () => {
    assert.deepEqual((await ids(db, rules({ rules: [{ field: 'liked', value: true }], sort: 'title' }))).sort(), ['a', 'c']);
    assert.deepEqual((await ids(db, rules({ rules: [{ field: 'liked', value: false }], sort: 'title' }))).sort(), ['b', 'd', 'local:e']);
  });

  it('play count: at least / at most', async () => {
    assert.deepEqual((await ids(db, rules({ rules: [{ field: 'plays', op: 'gte', value: 5 }], sort: 'mostPlayed' }))), ['d', 'a']);
    assert.deepEqual((await ids(db, rules({ rules: [{ field: 'plays', op: 'lte', value: 0 }] }))), ['c'], 'never played');
  });

  it('last played: within N days / not for N days (never played counts as "not")', async () => {
    assert.deepEqual((await ids(db, rules({ rules: [{ field: 'lastPlayed', op: 'within', days: 7 }], sort: 'title' }))).sort(), ['a', 'local:e']);
    assert.deepEqual((await ids(db, rules({ rules: [{ field: 'lastPlayed', op: 'notWithin', days: 100 }], sort: 'title' }))).sort(), ['b', 'c']);
  });

  it('"forgotten favourites": liked AND not played for 30 days', async () => {
    const r = rules({ rules: [{ field: 'liked', value: true }, { field: 'lastPlayed', op: 'notWithin', days: 1 }], sort: 'title' });
    assert.deepEqual(await ids(db, r), ['c', 'a'].sort(), 'a was played 2 days ago, c never – both are older than 1 day');
    const strict = rules({ rules: [{ field: 'liked', value: true }, { field: 'lastPlayed', op: 'notWithin', days: 30 }] });
    assert.deepEqual(await ids(db, strict), ['c']);
  });

  it('any / all', async () => {
    const parts: SmartRules['rules'] = [{ field: 'plays', op: 'gte', value: 10 }, { field: 'liked', value: true }];
    assert.deepEqual((await ids(db, rules({ match: 'any', rules: parts, sort: 'title' }))).sort(), ['a', 'c', 'd']);
    assert.deepEqual(await ids(db, rules({ match: 'all', rules: parts })), []);
  });

  it('artist / title contain – letters are not case sensitive, and % _ are taken literally', async () => {
    assert.deepEqual((await ids(db, rules({ rules: [{ field: 'artist', value: 'king' }], sort: 'title' }))).sort(), ['a', 'c']);
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'title', value: '100%' }] })), ['a']);
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'title', value: 'a_' }] })), ['a'], '"_" is not a wildcard');
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'title', value: '%' }] })), ['a'], 'a lone "%" does not match everything');
  });

  it('source: YouTube / on the device / saved offline', async () => {
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'source', value: 'local' }] })), ['local:e']);
    assert.equal((await ids(db, rules({ rules: [{ field: 'source', value: 'youtube' }] }))).length, 4);
    await repo.addOffline(db, song('b', 'Beta', 'YOASOBI'), { fileName: 'b.m4a', size: 1 });
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'source', value: 'offline' }] })), ['b']);
  });

  it('sort and limit', async () => {
    assert.deepEqual(await ids(db, rules({ sort: 'oldestPlayed', limit: 2 })), ['c', 'b'], 'never played, then the oldest play');
    assert.deepEqual(await ids(db, rules({ sort: 'title', limit: 3 })), ['a', 'b', 'd'], 'Alpha, Beta, Delta');
    assert.equal((await ids(db, rules({ sort: 'random', limit: 2 }))).length, 2);
    assert.equal((await ids(db, rules({ sort: 'added', limit: 1 })))[0], 'local:e', 'added last');
  });

  it('a damaged or hostile rule set cannot break the query or inject SQL', async () => {
    const hostile = sanitizeRules({
      match: "any'; DROP TABLE Song; --",
      sort: 'DROP TABLE',
      limit: 'many',
      rules: [{ field: 'artist', value: "x' OR 1=1 --" }, { field: 'nope' }, null, 5, { field: 'plays', op: 'gte; DROP', value: 1 }, { field: 'tag', op: 'has', tagId: 'x' }],
    });
    assert.deepEqual(hostile, { match: 'all', sort: 'recent', limit: DEFAULT_LIMIT, rules: [{ field: 'artist', value: "x' OR 1=1 --" }] });
    assert.deepEqual(await ids(db, hostile), [], 'the quote is just text');
    assert.equal((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM Song'))?.n, 5);
    const q = buildSmartQuery(hostile, 0);
    assert.ok(!q.sql.includes('OR 1=1'), 'user text is never in the SQL');
  });

  it('limits are kept in range', () => {
    assert.equal(sanitizeRules({ limit: 99999 }).limit, MAX_LIMIT);
    assert.equal(sanitizeRules({ limit: 0 }).limit, 1);
    assert.equal(sanitizeRules(undefined).limit, DEFAULT_LIMIT);
  });

  it('is described in plain Japanese', () => {
    assert.equal(describeRules(rules({})), 'すべての曲');
    assert.equal(describeRules(rules({ rules: [{ field: 'liked', value: true }, { field: 'lastPlayed', op: 'notWithin', days: 30 }] })), 'お気に入り・30日以上聞いていない');
    assert.equal(describeRules(rules({ match: 'any', rules: [{ field: 'plays', op: 'gte', value: 10 }, { field: 'source', value: 'local' }] })), '10回以上再生 または 端末内');
    assert.equal(describeRules(rules({ rules: [{ field: 'tag', op: 'has', tagId: 3 }] }), () => '作業用'), '作業用タグあり');
  });
});

describe('tags', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('creates tags once (letter case ignored) and refuses empty names', async () => {
    const a = await repo.createTag(db, '作業用');
    assert.equal(await repo.createTag(db, ' 作業用 '), a);
    const b = await repo.createTag(db, 'Chill');
    assert.equal(await repo.createTag(db, 'chill'), b);
    await assert.rejects(() => repo.createTag(db, '   '), /タグの名前/);
    assert.equal((await repo.tags(db)).length, 2);
  });

  it('tags a song, counts, and removes', async () => {
    const t = await repo.createTag(db, '夜');
    await repo.setSongTag(db, song('a', 'A', 'x'), t, true);
    await repo.setSongTag(db, song('a', 'A', 'x'), t, true); // twice: still one
    await repo.setSongTag(db, song('b', 'B', 'x'), t, true);
    assert.deepEqual({ ...(await repo.tags(db))[0] }, { id: t, name: '夜', songCount: 2 });
    assert.deepEqual(await repo.tagIdsOfSong(db, 'a'), [t]);
    await repo.setSongTag(db, song('a', 'A', 'x'), t, false);
    assert.deepEqual(await repo.tagIdsOfSong(db, 'a'), []);
    assert.equal((await repo.tags(db))[0].songCount, 1);
  });

  it('songs by tags: any / all', async () => {
    const work = await repo.createTag(db, '作業用');
    const night = await repo.createTag(db, '夜');
    for (const [id, tg] of [['a', [work]], ['b', [night]], ['c', [work, night]]] as const) for (const t of tg) await repo.setSongTag(db, song(id, id.toUpperCase(), 'x'), t, true);
    assert.deepEqual((await repo.songsByTags(db, [work, night], 'any')).map((s) => s.id), ['a', 'b', 'c']);
    assert.deepEqual((await repo.songsByTags(db, [work, night], 'all')).map((s) => s.id), ['c']);
    assert.deepEqual(await repo.songsByTags(db, [], 'any'), []);
  });

  it('renaming refuses a name that is taken; deleting a tag untags the songs but keeps them', async () => {
    const a = await repo.createTag(db, 'A');
    const b = await repo.createTag(db, 'B');
    await assert.rejects(() => repo.renameTag(db, a, 'b'), /同じ名前/);
    await repo.renameTag(db, a, 'A2');
    await repo.setSongTag(db, song('s', 'S', 'x'), a, true);
    await repo.deleteTag(db, a);
    assert.deepEqual(await repo.tagIdsOfSong(db, 's'), []);
    assert.ok(await db.first('SELECT 1 FROM Song WHERE id = ?', ['s']));
    assert.deepEqual((await repo.tags(db)).map((t) => t.id), [b]);
  });

  it('a tag rule in a smart playlist', async () => {
    const t = await repo.createTag(db, '作業用');
    await repo.setSongTag(db, song('a', 'A', 'x'), t, true);
    await repo.upsertSong(db, song('b', 'B', 'x'));
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'tag', op: 'has', tagId: t }] })), ['a']);
    assert.deepEqual(await ids(db, rules({ rules: [{ field: 'tag', op: 'hasNot', tagId: t }] })), ['b']);
  });

  it('smart playlists are saved, listed, renamed, and removed; a damaged entry does not break the list', async () => {
    const id = await repo.saveSmartPlaylist(db, { name: '  忘れていた曲  ', rules: rules({ rules: [{ field: 'liked', value: true }] }) });
    await repo.saveSmartPlaylist(db, { name: 'x', rules: rules({}) });
    await db.run('INSERT INTO SmartPlaylist (name, rules, createdAt) VALUES (?,?,?)', ['壊れた', '{not json', 1]);
    const list = await repo.smartPlaylists(db);
    assert.equal(list.length, 3);
    assert.equal(list.find((p) => p.id === id)?.name, '忘れていた曲');
    assert.deepEqual(list.find((p) => p.name === '壊れた')?.rules, emptyRules());
    await repo.saveSmartPlaylist(db, { id, name: '改名', rules: rules({ match: 'any' }) });
    assert.equal((await repo.getSmartPlaylist(db, id))?.name, '改名');
    await repo.deleteSmartPlaylist(db, id);
    assert.equal(await repo.getSmartPlaylist(db, id), null);
  });

  it('the migration can run again', async () => {
    const t = await repo.createTag(db, 'x');
    await migrate(db);
    assert.equal((await repo.tags(db))[0].id, t);
  });
});
