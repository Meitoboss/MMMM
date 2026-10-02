import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';

import { recentInsertIndex } from '../src/core/homeLayout';
import { LOCAL_ARTIST, fileExtension, isLocalId, makeLocalId, parseLocalName } from '../src/core/localMeta';
import { moveItem, targetIndex } from '../src/core/reorder';
import type { Db, SqlValue } from '../src/db/driver';
import * as repo from '../src/db/repo';
import { migrate } from '../src/db/schema';

function nodeDb(): Db {
  const raw = new DatabaseSync(':memory:');
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

describe('local file names', () => {
  it('splits "Artist - Title" and drops the extension', () => {
    assert.deepEqual(parseLocalName('King Gnu - AIZO.mp3'), { artist: 'King Gnu', title: 'AIZO' });
    assert.deepEqual(parseLocalName('米津玄師 – Lemon.m4a'), { artist: '米津玄師', title: 'Lemon' });
  });
  it('removes leading track numbers', () => {
    assert.deepEqual(parseLocalName('01 Stardom.m4a'), { title: 'Stardom' });
    assert.deepEqual(parseLocalName('07. Hello_World.flac'), { title: 'Hello World' });
    assert.deepEqual(parseLocalName('Artist - 03 Song.mp3'), { artist: 'Artist', title: 'Song' });
  });
  it('keeps names that are only digits or have no separator', () => {
    assert.equal(parseLocalName('1999.mp3').title, '1999');
    assert.equal(parseLocalName('recording').title, 'recording');
  });
  it('extension helper', () => {
    assert.equal(fileExtension('Song.MP3'), '.mp3');
    assert.equal(fileExtension('noext'), '.m4a');
    assert.equal(fileExtension('weird.toolongext'), '.m4a');
  });
  it('ids are recognisable and unique', () => {
    const a = makeLocalId(1000, () => 0.1);
    const b = makeLocalId(1000, () => 0.2);
    assert.ok(isLocalId(a) && a !== b);
    assert.ok(!isLocalId('dQw4w9WgXcQ'));
    assert.match(a, /^local:[0-9a-z]+$/);
  });
});

describe('local files in the database', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('adds, lists (newest first), resolves and deletes', async () => {
    const a = await repo.addLocalFile(db, { id: 'local:aaa', fileName: 'aaa.mp3', title: 'AIZO', artist: 'King Gnu', size: 100 });
    assert.equal(a.title, 'AIZO');
    assert.deepEqual(a.artists, [{ name: 'King Gnu' }]);
    await new Promise((r) => setTimeout(r, 5));
    await repo.addLocalFile(db, { id: 'local:bbb', fileName: 'bbb.m4a', title: 'Stardom' });

    const list = await repo.localSongs(db);
    assert.deepEqual(list.map((s) => s.id), ['local:bbb', 'local:aaa']);
    assert.equal(list[0].artists[0].name, LOCAL_ARTIST); // no artist in the file name

    assert.equal(await repo.localFileName(db, 'local:aaa'), 'aaa.mp3');
    assert.equal(await repo.localFileName(db, 'nope'), null);

    assert.equal(await repo.deleteLocalFile(db, 'local:aaa'), 'aaa.mp3');
    assert.deepEqual((await repo.localSongs(db)).map((s) => s.id), ['local:bbb']);
    assert.equal(await repo.getSong(db, 'local:aaa'), null);
  });

  it('local songs work with likes, playlists and history; deleting removes them from playlists', async () => {
    const song = await repo.addLocalFile(db, { id: 'local:aaa', fileName: 'aaa.mp3', title: 'AIZO' });
    assert.equal(await repo.toggleLike(db, song), true);
    const pl = await repo.createPlaylist(db, 'Mine');
    assert.equal(await repo.addToPlaylist(db, pl, [song]), 1);
    await repo.recordPlay(db, song, 30_000);
    assert.deepEqual((await repo.history(db)).map((s) => s.id), ['local:aaa']);
    // the song row must survive these upserts (INSERT OR IGNORE) and keep its file link
    assert.equal(await repo.localFileName(db, 'local:aaa'), 'aaa.mp3');

    await repo.deleteLocalFile(db, 'local:aaa');
    assert.equal((await repo.playlistSongs(db, pl)).length, 0);
    assert.equal((await repo.history(db)).length, 0);
  });

  it('migration is repeatable (existing installs get the new table)', async () => {
    await migrate(db);
    await migrate(db);
    assert.equal((await repo.localSongs(db)).length, 0);
  });
});

describe('reorder helpers', () => {
  it('moves items', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
    assert.deepEqual(moveItem(['a', 'b'], 1, 1), ['a', 'b']);
    assert.deepEqual(moveItem(['a', 'b'], 5, 0), ['a', 'b']);
  });
  it('does not mutate its input', () => {
    const src = ['a', 'b', 'c'];
    moveItem(src, 0, 2);
    assert.deepEqual(src, ['a', 'b', 'c']);
  });
  it('maps drag distance to a row index (clamped)', () => {
    assert.equal(targetIndex(2, 0, 64, 6), 2);
    assert.equal(targetIndex(2, 40, 64, 6), 3); // more than half a row down
    assert.equal(targetIndex(2, 30, 64, 6), 2);
    assert.equal(targetIndex(2, -70, 64, 6), 1);
    assert.equal(targetIndex(2, 9999, 64, 6), 5);
    assert.equal(targetIndex(2, -9999, 64, 6), 0);
    assert.equal(targetIndex(0, 10, 64, 0), 0);
  });
});

describe('home layout', () => {
  it('goes right after the last hits / trending shelf', () => {
    assert.equal(recentInsertIndex(['Listen again', "Today's hits", 'Trending', 'Mixed for you']), 3);
    assert.equal(recentInsertIndex(['急上昇', '新しいアルバム']), 1);
    assert.equal(recentInsertIndex(["Today’s Hits"]), 1);
  });
  it('falls back to after the first two shelves', () => {
    assert.equal(recentInsertIndex(['A', 'B', 'C', 'D']), 2);
    assert.equal(recentInsertIndex(['A']), 1);
    assert.equal(recentInsertIndex([]), 0);
  });
});
