import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { configure, defaultConfig } from '../src/core/config';
import { pickAudioFormat, pickM4aFormat } from '../src/core/innertube/webpot';
import { runImport, type ImportDeps, type InboxFile } from '../src/core/localImport';
import { isAudioFileName, nameFromContentUri } from '../src/core/localMeta';
import { pickAudio } from '../src/core/streams/piped';
import { isIosPlayable, isPlayableMime } from '../src/core/streams/util';
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

describe('Android: which audio the player can take', () => {
  afterEach(() => configure({ ...defaultConfig, visitorData: undefined }));

  it('iOS (default) refuses WebM/Opus, Android accepts it', () => {
    assert.equal(defaultConfig.platform, 'ios');
    assert.equal(isPlayableMime('audio/webm'), false);
    assert.equal(isPlayableMime('audio/mp4'), true);
    configure({ platform: 'android' });
    assert.equal(isPlayableMime('audio/webm'), true);
    assert.equal(isPlayableMime('audio/ogg'), true);
    assert.equal(isPlayableMime('video/mp4'), false, 'video is never taken as audio');
    assert.equal(isPlayableMime(undefined), false);
    assert.equal(isIosPlayable('audio/webm'), false, 'the iOS check itself does not change');
  });

  it('Piped: Android takes the best stream whatever its container; iOS only AAC', () => {
    const streams = [
      { itag: 251, url: 'opus', bitrate: 160000, mimeType: 'audio/webm' },
      { itag: 140, url: 'aac', bitrate: 128000, mimeType: 'audio/mp4' },
    ];
    assert.equal(pickAudio(streams)?.itag, 140);
    configure({ platform: 'android' });
    assert.equal(pickAudio(streams)?.itag, 251);
  });

  it('YouTube formats: AAC is always preferred; Android falls back to WebM only when there is no AAC', () => {
    const webm = { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'w' };
    const m4a = { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, url: 'm' };
    assert.equal(pickAudioFormat([webm, m4a])?.itag, 140);
    assert.equal(pickAudioFormat([webm]), undefined, 'iOS has nothing it can play');
    configure({ platform: 'android' });
    assert.equal(pickAudioFormat([webm, m4a])?.itag, 140);
    assert.equal(pickAudioFormat([webm])?.itag, 251);
    assert.equal(pickM4aFormat([webm]), undefined);
  });
});

describe('Android: files from the system folder picker', () => {
  it('reads the file name out of a content:// uri', () => {
    const base = 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/';
    assert.equal(nameFromContentUri(`${base}primary%3AMusic%2FMy%20Song.mp3`), 'My Song.mp3');
    assert.equal(nameFromContentUri(`${base}primary%3AMusic%2FAlbum%2F01%20%E5%A4%9C%E3%81%AE%E6%AD%8C.m4a`), '01 夜の歌.m4a');
    assert.equal(nameFromContentUri(`${base}primary%3ASong.flac`), 'Song.flac', 'file in the root of the storage');
    assert.equal(nameFromContentUri('content://x/%E0%A4%A.mp3'), '%E0%A4%A.mp3', 'an invalid escape does not throw');
  });
  it('providers that hide the name are simply not music', () => {
    assert.ok(!isAudioFileName(nameFromContentUri('content://com.android.providers.downloads.documents/document/msf%3A1234')));
    assert.ok(isAudioFileName(nameFromContentUri('content://x/document/primary%3AMusic%2Fa.mp3')));
  });
});

/** Android style: files are COPIED and stay in the picked folder */
function fakeAndroid(names: string[], db: Db) {
  const folder: InboxFile[] = names.map((n) => ({ name: n, uri: `content://x/document/primary%3AMusic%2F${encodeURIComponent(n)}` }));
  const copies = new Map<string, string>();
  const deps: ImportDeps = {
    list: async () => folder,
    move: async (from, stored) => {
      copies.set(stored, from);
    },
    undo: async (stored) => {
      copies.delete(stored);
    },
    size: async () => 4321,
    alreadyImported: (f) => repo.isSourceImported(db, f.uri),
    markImported: (f) => repo.markSourceImported(db, f.uri),
  };
  return { deps, folder, copies };
}

describe('Android: importing by copying', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('copies the music, leaves the originals alone, and imports each file only once', async () => {
    const a = fakeAndroid(['One.mp3', 'King Gnu - Two.m4a'], db);
    const first = await runImport(db, a.deps);
    assert.equal(first.found, 2);
    assert.equal(first.added.length, 2);
    assert.equal(a.folder.length, 2, 'the picked folder is untouched');
    assert.equal(a.copies.size, 2);

    const second = await runImport(db, a.deps);
    assert.equal(second.found, 0, 'nothing new in the folder');
    assert.equal((await repo.localSongs(db)).length, 2, 'no duplicates');
  });

  it('a file added to the folder later is picked up on the next import', async () => {
    const a = fakeAndroid(['One.mp3'], db);
    await runImport(db, a.deps);
    a.folder.push({ name: 'Three.wav', uri: 'content://x/document/primary%3AMusic%2FThree.wav' });
    const r = await runImport(db, a.deps);
    assert.deepEqual([r.found, r.added.length], [1, 1]);
    assert.equal((await repo.localSongs(db)).length, 2);
  });

  it('a failed copy is not marked as imported, so it is retried next time', async () => {
    const a = fakeAndroid(['Bad.mp3'], db);
    const original = a.deps.move;
    a.deps.move = async () => {
      throw new Error('no space left');
    };
    const r1 = await runImport(db, a.deps);
    assert.deepEqual(r1.failed, ['Bad.mp3']);
    a.deps.move = original;
    const r2 = await runImport(db, a.deps);
    assert.equal(r2.added.length, 1);
  });

  it('the "already imported" table survives repeated migrations', async () => {
    await repo.markSourceImported(db, 'content://k');
    await migrate(db);
    assert.equal(await repo.isSourceImported(db, 'content://k'), true);
    assert.equal(await repo.isSourceImported(db, 'content://other'), false);
  });
});
