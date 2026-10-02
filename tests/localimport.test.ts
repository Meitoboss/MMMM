import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';

import { runImport, type ImportDeps, type InboxFile } from '../src/core/localImport';
import { AUDIO_EXTENSIONS, isAudioFileName } from '../src/core/localMeta';
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

/** a fake "phone": an inbox folder, the app store, and a log of what happened to files */
function fakeFs(inbox: string[]) {
  const waiting = new Map<string, InboxFile>(inbox.map((n) => [n, { name: n, uri: `file:///Music/${encodeURIComponent(n)}` }]));
  const store = new Map<string, string>(); // stored name -> original uri
  const failMove = new Set<string>();
  const deps: ImportDeps = {
    list: async () => [...waiting.values()],
    move: async (from, stored) => {
      const f = [...waiting.values()].find((x) => x.uri === from);
      if (!f) throw new Error('no such file');
      if (failMove.has(f.name)) throw new Error('disk full');
      waiting.delete(f.name);
      store.set(stored, from);
    },
    undo: async (stored, original) => {
      const name = decodeURIComponent(original.split('/').pop() as string);
      store.delete(stored);
      waiting.set(name, { name, uri: original });
    },
    size: async () => 1234,
  };
  return { deps, waiting, store, failMove };
}

describe('which files count as music', () => {
  it('accepts the formats the iPhone can play, in any letter case', () => {
    for (const n of ['a.mp3', 'B.M4A', 'c.flac', 'd.wav', 'e.aac', 'f.AIFF', '日本語の曲.mp3', 'x y z.caf']) assert.ok(isAudioFileName(n), n);
    assert.ok(AUDIO_EXTENSIONS.includes('.mp3'));
  });
  it('ignores everything else, including hidden files', () => {
    for (const n of ['notes.txt', 'cover.jpg', '.DS_Store', '._song.mp3', 'folder', 'song', 'song.mp3.part', 'archive.zip', 'x.ogg']) assert.ok(!isAudioFileName(n), n);
  });
});

describe('importing from the Music folder', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('moves every file into the app, names them from the file name, and lists them newest first', async () => {
    const fs = fakeFs(['King Gnu - AIZO.mp3', '01 夜の歌.m4a']);
    const r = await runImport(db, fs.deps);
    assert.equal(r.found, 2);
    assert.equal(r.failed.length, 0);
    assert.equal(r.added.length, 2);
    assert.equal(fs.waiting.size, 0, 'the folder is empty afterwards');
    assert.equal(fs.store.size, 2);

    const songs = await repo.localSongs(db);
    const aizo = songs.find((s) => s.title === 'AIZO');
    assert.deepEqual(aizo?.artists, [{ name: 'King Gnu' }]);
    assert.ok(songs.find((s) => s.title === '夜の歌'), 'track number removed, Japanese kept');
    for (const s of songs) assert.ok(s.id.startsWith('local:'));
    // stored names are plain ASCII + the original extension
    for (const stored of fs.store.keys()) assert.match(stored, /^[a-z0-9]+\.(mp3|m4a)$/);
  });

  it('does nothing (and says so) when the folder is empty', async () => {
    const r = await runImport(db, fakeFs([]).deps);
    assert.deepEqual([r.found, r.added.length, r.failed.length], [0, 0, 0]);
  });

  it('a file that cannot be moved is reported and left where it was; the others still import', async () => {
    const fs = fakeFs(['good.mp3', 'bad.mp3']);
    fs.failMove.add('bad.mp3');
    const r = await runImport(db, fs.deps);
    assert.deepEqual(r.failed, ['bad.mp3']);
    assert.equal(r.added.length, 1);
    assert.ok(fs.waiting.has('bad.mp3'));
    assert.equal((await repo.localSongs(db)).length, 1);
  });

  it('importing twice never duplicates: the second run finds an empty folder', async () => {
    const fs = fakeFs(['a.mp3']);
    await runImport(db, fs.deps);
    const again = await runImport(db, fs.deps);
    assert.equal(again.found, 0);
    assert.equal((await repo.localSongs(db)).length, 1);
  });

  it('two files with the same name become two songs with different stored names', async () => {
    const fs = fakeFs(['same.mp3']);
    await runImport(db, fs.deps);
    fs.waiting.set('same.mp3', { name: 'same.mp3', uri: 'file:///Music/same.mp3' });
    await runImport(db, fs.deps);
    assert.equal((await repo.localSongs(db)).length, 2);
    assert.equal(fs.store.size, 2);
  });
});
