import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';

import { DownloadQueue, type JobState } from '../src/core/downloadQueue';
import { type DownloadDeps, extensionFor, runDownload, safeFileStem } from '../src/core/offlineJobs';
import type { AudioSource, SongItem } from '../src/core/types';
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

function fakeDeps(over: Partial<DownloadDeps> = {}) {
  const files = new Map<string, number>();
  const log: string[] = [];
  const deps: DownloadDeps = {
    resolve: async (id): Promise<AudioSource> => {
      log.push(`resolve ${id}`);
      return { url: `https://cdn/${id}`, mimeType: 'audio/mp4', via: 'webpot' };
    },
    download: async (_src, fileName, onProgress) => {
      onProgress(0.5);
      files.set(fileName, 3_400_000);
      onProgress(1);
      return 3_400_000;
    },
    remove: async (fileName) => void files.delete(fileName),
    ...over,
  };
  return { deps, files, log };
}

describe('file names', () => {
  it('maps formats to extensions', () => {
    assert.equal(extensionFor('audio/mp4'), '.m4a');
    assert.equal(extensionFor('audio/mp4; codecs="mp4a.40.2"'), '.m4a');
    assert.equal(extensionFor('video/mp4'), '.mp4');
    assert.equal(extensionFor('audio/webm'), '.webm');
    assert.equal(extensionFor(undefined), '.m4a');
  });
  it('keeps names safe', () => {
    assert.equal(safeFileStem('cy-4YL--Cm8'), 'cy-4YL--Cm8');
    assert.equal(safeFileStem('../etc/passwd'), '___etc_passwd');
    assert.equal(safeFileStem(''), 'song');
  });
});

describe('saving a song offline', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('downloads, records it, and lists it', async () => {
    const f = fakeDeps();
    const progress: number[] = [];
    const r = await runDownload(db, f.deps, song('abc'), (p) => progress.push(p));
    assert.deepEqual([r.fileName, r.size, r.already], ['abc.m4a', 3_400_000, false]);
    assert.deepEqual(progress, [0.5, 1]);
    assert.deepEqual((await repo.offlineSongs(db)).map((s) => s.id), ['abc']);
    assert.equal(await repo.offlineTotalSize(db), 3_400_000);
    assert.equal((await repo.offlineFile(db, 'abc'))?.mimeType, 'audio/mp4');
    assert.deepEqual(await repo.offlineIds(db), ['abc']);
  });

  it('remembers the loudness so a saved copy can be evened out without the network', async () => {
    const f = fakeDeps({ resolve: async (id) => ({ url: `https://cdn/${id}`, mimeType: 'audio/mp4', via: 'webpot', itag: 140, loudnessDb: 5.5 }) });
    await runDownload(db, f.deps, song('abc'));
    assert.equal(await repo.loudnessFor(db, 'abc'), 5.5);
    assert.equal(await repo.loudnessFor(db, 'unknown'), null);
    // a song without loudness information leaves nothing behind
    await runDownload(db, fakeDeps().deps, song('plain'));
    assert.equal(await repo.loudnessFor(db, 'plain'), null);
  });

  it('does not download twice', async () => {
    const f = fakeDeps();
    await runDownload(db, f.deps, song('abc'));
    const again = await runDownload(db, f.deps, song('abc'));
    assert.equal(again.already, true);
    assert.equal(f.log.length, 1, 'the stream was resolved only once');
  });

  it('refuses songs that are already files on the device', async () => {
    await assert.rejects(() => runDownload(db, fakeDeps().deps, song('local:x1')), /すでに端末内/);
  });

  it('a failed download leaves nothing behind', async () => {
    const f = fakeDeps({ download: async () => { throw new Error('HTTP 403'); } });
    await assert.rejects(() => runDownload(db, f.deps, song('bad')), /403/);
    assert.deepEqual(await repo.offlineIds(db), []);
  });

  it('a cancelled download removes its file and records nothing', async () => {
    const f = fakeDeps();
    await assert.rejects(() => runDownload(db, f.deps, song('c1'), undefined, () => true), /cancelled/);
    assert.equal(f.files.size, 0);
    assert.deepEqual(await repo.offlineIds(db), []);
  });

  it('removing the copy keeps the song, returns the file name, and the library entry stays', async () => {
    await runDownload(db, fakeDeps().deps, song('abc'));
    await repo.toggleLike(db, song('abc'));
    assert.equal(await repo.deleteOffline(db, 'abc'), 'abc.m4a');
    assert.equal(await repo.deleteOffline(db, 'abc'), null);
    assert.equal((await repo.likedSongs(db)).length, 1);
    assert.deepEqual(await repo.allOfflineFileNames(db), []);
  });

  it('newest first; the migration can run again', async () => {
    await runDownload(db, fakeDeps().deps, song('a'));
    await wait(3);
    await runDownload(db, fakeDeps().deps, song('b'));
    await migrate(db);
    assert.deepEqual((await repo.offlineSongs(db)).map((s) => s.id), ['b', 'a']);
  });
});

describe('download queue', () => {
  it('runs one at a time, in order, and reports progress', async () => {
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const q = new DownloadQueue(
      async (id, onProgress) => {
        active++;
        maxActive = Math.max(maxActive, active);
        events.push(`start ${id}`);
        onProgress(0.5);
        await wait(5);
        events.push(`end ${id}`);
        active--;
      },
      (id, s) => events.push(`${id}:${s?.status ?? 'gone'}`),
    );
    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    await wait(60);
    assert.equal(maxActive, 1);
    assert.deepEqual(events.filter((e) => e.startsWith('start')), ['start a', 'start b', 'start c']);
    assert.equal(q.get('c')?.status, 'done');
  });

  it('ignores a job that is already queued or running', () => {
    const q = new DownloadQueue(async () => wait(20), () => undefined);
    assert.equal(q.enqueue('a'), true);
    assert.equal(q.enqueue('a'), false);
  });

  it('a failed job is marked and does not stop the others', async () => {
    const states: Record<string, JobState | null> = {};
    const q = new DownloadQueue(
      async (id) => {
        if (id === 'bad') throw new Error('HTTP 403');
      },
      (id, s) => (states[id] = s),
    );
    q.enqueue('bad');
    q.enqueue('good');
    await wait(30);
    assert.deepEqual([states.bad?.status, states.bad?.error], ['error', 'HTTP 403']);
    assert.equal(states.good?.status, 'done');
    q.clear('bad');
    assert.equal(states.bad, null);
  });

  it('cancelling a queued job removes it; cancelling the running one stops it', async () => {
    const started: string[] = [];
    const states: Record<string, JobState | null> = {};
    const q = new DownloadQueue(
      async (id, _p, isCancelled) => {
        started.push(id);
        for (let i = 0; i < 20 && !isCancelled(); i++) await wait(5);
        if (isCancelled()) throw new Error('cancelled');
      },
      (id, s) => (states[id] = s),
    );
    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    await wait(8);
    q.cancel('b'); // still waiting
    q.cancel('a'); // running
    await wait(220); // 'c' needs about 100 ms once it starts
    assert.deepEqual(started, ['a', 'c'], 'b never started');
    assert.equal(states.a, null, 'cancelled jobs disappear');
    assert.equal(states.b, null);
    assert.equal(states.c?.status, 'done');
  });

  it('can be queued again after it finished', async () => {
    const q = new DownloadQueue(async () => undefined, () => undefined);
    q.enqueue('a');
    await wait(10);
    assert.equal(q.enqueue('a'), true);
  });
});
