import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';

import type { SongItem } from '../src/core/types';
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

const song = (id: string): SongItem => ({ kind: 'song', id, title: `T ${id}`, artists: [{ name: 'A' }], explicit: false });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('recently played (home shelf)', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('shows a song as soon as it starts – without any play time', async () => {
    await repo.markPlayed(db, song('a'));
    assert.deepEqual((await repo.recentSongs(db)).map((x) => x.id), ['a']);
    assert.equal((await repo.history(db)).length, 0, 'the end-of-song history is separate and still empty');
  });

  it('newest first, and playing a song again moves it to the top without duplicating it', async () => {
    await repo.markPlayed(db, song('a'));
    await wait(3);
    await repo.markPlayed(db, song('b'));
    await wait(3);
    await repo.markPlayed(db, song('c'));
    await wait(3);
    await repo.markPlayed(db, song('a'));
    assert.deepEqual((await repo.recentSongs(db)).map((x) => x.id), ['a', 'c', 'b']);
  });

  it('respects the limit and does not touch likes or play time', async () => {
    await repo.toggleLike(db, song('a'));
    await repo.recordPlay(db, song('a'), 5000);
    for (const id of ['a', 'b', 'c', 'd']) {
      await repo.markPlayed(db, song(id));
      await wait(2);
    }
    assert.equal((await repo.recentSongs(db, 2)).length, 2);
    const row = await db.first<{ likedAt: number | null; totalPlayTimeMs: number }>('SELECT likedAt, totalPlayTimeMs FROM Song WHERE id = ?', ['a']);
    assert.ok(row?.likedAt);
    assert.equal(row?.totalPlayTimeMs, 5000);
  });

  it('works for songs imported from the device, and disappears with them', async () => {
    const local = await repo.addLocalFile(db, { id: 'local:x1', fileName: 'x1.mp3', title: 'My song' });
    await repo.markPlayed(db, local);
    assert.equal((await repo.recentSongs(db))[0].id, 'local:x1');
    await repo.deleteLocalFile(db, 'local:x1');
    assert.equal((await repo.recentSongs(db)).length, 0);
  });

  it('the migration can run again on an existing database (updates keep their data)', async () => {
    await repo.markPlayed(db, song('a'));
    await migrate(db);
    assert.equal((await repo.recentSongs(db)).length, 1);
  });
});
