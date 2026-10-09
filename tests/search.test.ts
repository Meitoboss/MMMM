import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';

import { LiveSearch } from '../src/core/liveSearch';
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const song = (id: string, title: string, artist: string): SongItem => ({ kind: 'song', id, title, artists: [{ name: artist }], explicit: false });

describe('search history (50 entries)', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('keeps the 50 newest searches', async () => {
    for (let i = 1; i <= 60; i++) await repo.addSearchQuery(db, `query ${i}`);
    const h = await repo.searchHistory(db);
    assert.equal(h.length, 50);
    assert.equal(h[0], 'query 60');
    assert.equal(h.at(-1), 'query 11');
    assert.equal(repo.SEARCH_HISTORY_LIMIT, 50);
  });

  it('a repeated search moves to the top, whatever the letter case', async () => {
    for (const q of ['alpha', 'beta', 'gamma']) await repo.addSearchQuery(db, q);
    await repo.addSearchQuery(db, 'ALPHA');
    assert.deepEqual(await repo.searchHistory(db), ['ALPHA', 'gamma', 'beta']);
  });

  it('typing "k", "ki", "kin" … leaves one entry, not one per letter', async () => {
    for (const q of ['k', 'ki', 'kin', 'king', 'king g', 'king gnu']) await repo.addSearchQuery(db, q);
    assert.deepEqual(await repo.searchHistory(db), ['king gnu']);
  });

  it('an unrelated search does not replace the previous one; a shorter one does not either', async () => {
    await repo.addSearchQuery(db, 'king gnu');
    await repo.addSearchQuery(db, 'yoasobi');
    await repo.addSearchQuery(db, 'yo');
    assert.deepEqual(await repo.searchHistory(db), ['yo', 'yoasobi', 'king gnu']);
  });

  it('only the LATEST entry is replaced by an extension of it', async () => {
    await repo.addSearchQuery(db, 'ki');
    await repo.addSearchQuery(db, 'yoasobi');
    await repo.addSearchQuery(db, 'king'); // extends "ki", but "ki" is not the latest
    assert.deepEqual(await repo.searchHistory(db), ['king', 'yoasobi', 'ki']);
  });

  it('empty and over-long searches', async () => {
    await repo.addSearchQuery(db, '   ');
    assert.deepEqual(await repo.searchHistory(db), []);
    await repo.addSearchQuery(db, 'x'.repeat(300));
    assert.equal((await repo.searchHistory(db))[0].length, 100);
  });

  it('filters by what has been typed, deletes one, clears all', async () => {
    for (const q of ['alpha', 'alps', 'beta']) await repo.addSearchQuery(db, q);
    assert.deepEqual(await repo.searchHistory(db, 'al'), ['alps', 'alpha']);
    assert.deepEqual(await repo.searchHistory(db, '%'), [], '% is not a wildcard');
    await repo.deleteSearchQuery(db, 'alps');
    assert.equal((await repo.searchHistory(db)).length, 2);
    await repo.clearSearchHistory(db);
    assert.deepEqual(await repo.searchHistory(db), []);
  });
});

describe('searching what is on the device (offline mode)', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
    await repo.addOffline(db, song('a', 'AIZO', 'King Gnu'), { fileName: 'a.m4a', size: 1, mimeType: 'audio/mp4' });
    await new Promise((r) => setTimeout(r, 3));
    await repo.addOffline(db, song('b', 'Pretender', 'Official髭男dism'), { fileName: 'b.m4a', size: 1 });
    await new Promise((r) => setTimeout(r, 3));
    await repo.addOffline(db, song('v', 'AIZO (Music Video)', 'King Gnu'), { fileName: 'v.mp4', size: 1, mimeType: 'video/mp4' });
    await new Promise((r) => setTimeout(r, 3));
    await repo.addLocalFile(db, { id: 'local:x1', fileName: 'x1.mp3', title: '夜に駆ける', artist: 'YOASOBI' });
    await repo.upsertSong(db, song('online-only', 'AIZO', 'Not saved')); // known to the library but NOT on the device
  });
  const ids = async (q: string, kind: repo.DownloadedKind = 'all') => (await repo.searchDownloaded(db, q, kind)).map((s) => s.id);

  it('no words: everything on the device, newest first; songs that are not saved are not there', async () => {
    assert.deepEqual(await ids(''), ['local:x1', 'v', 'b', 'a']);
    assert.ok(!(await ids('')).includes('online-only'));
  });

  it('every word must match the title or the artist', async () => {
    assert.deepEqual((await ids('king gnu aizo')).sort(), ['a', 'v']);
    assert.deepEqual(await ids('king 髭男'), [], 'two words that never belong to one song');
    assert.deepEqual(await ids('髭男'), ['b']);
    assert.deepEqual(await ids('yoasobi'), ['local:x1']);
    assert.deepEqual(await ids('夜に'), ['local:x1']);
    assert.deepEqual((await ids('KING　GNU')).sort(), ['a', 'v'], 'letter case and a full-width space do not matter');
  });

  it('the kinds: songs / videos / files from the device', async () => {
    assert.deepEqual((await ids('', 'audio')).sort(), ['a', 'b']);
    assert.deepEqual(await ids('', 'video'), ['v']);
    assert.deepEqual(await ids('', 'local'), ['local:x1']);
    assert.deepEqual(await ids('aizo', 'audio'), ['a']);
    assert.deepEqual(await ids('aizo', 'video'), ['v']);
  });

  it('% and _ are taken literally; nothing found is an empty list', async () => {
    assert.deepEqual(await ids('%'), []);
    assert.deepEqual(await ids('_'), []);
    assert.deepEqual(await ids('no such song'), []);
  });

  it('a removed copy is no longer found', async () => {
    await repo.deleteOffline(db, 'a');
    assert.ok(!(await ids('')).includes('a'));
  });
});

describe('live search (search as you type)', () => {
  function make(delay: (q: string) => number = () => 0, pause = 30) {
    const calls: [string, string | undefined][] = [];
    const log: string[] = [];
    const ls = new LiveSearch<string>(
      {
        search: async (q, f) => {
          calls.push([q, f]);
          await wait(delay(q));
          if (q === 'boom') throw new Error('HTTP 500');
          return q.toUpperCase();
        },
        onStart: (q) => log.push(`start:${q}`),
        onResult: (q, _f, r) => log.push(`result:${r}`),
        onError: (q, _f, e) => log.push(`error:${(e as Error).message}`),
        onClear: () => log.push('clear'),
      },
      pause,
    );
    return { ls, calls, log };
  }

  it('fast typing makes ONE search, for the final text', async () => {
    const { ls, calls, log } = make();
    for (const t of ['k', 'ki', 'kin', 'king']) {
      ls.type(t);
      await wait(8);
    }
    await wait(120);
    assert.deepEqual(calls, [['king', undefined]]);
    assert.deepEqual(log, ['start:king', 'result:KING']);
  });

  it('a pause in typing starts the search; going on typing starts another', async () => {
    const { ls, calls } = make();
    ls.type('ki');
    await wait(100);
    ls.type('king');
    await wait(100);
    assert.deepEqual(calls.map((c) => c[0]), ['ki', 'king']);
  });

  it('an answer for an older text is thrown away', async () => {
    const { ls, log } = make((q) => (q === 'slow' ? 150 : 5));
    ls.type('slow');
    await wait(60); // "slow" is running
    ls.type('fast');
    await wait(260);
    assert.ok(!log.includes('result:SLOW'), `log: ${log.join(' ')}`);
    assert.ok(log.includes('result:FAST'));
  });

  it('Enter / a tapped suggestion searches at once and cancels the waiting one', async () => {
    const { ls, calls } = make((_q) => 0, 200);
    ls.type('ki');
    await ls.now('king gnu');
    await wait(260);
    assert.deepEqual(calls.map((c) => c[0]), ['king gnu']);
  });

  it('never repeats a search that is shown, unless forced', async () => {
    const { ls, calls } = make();
    await ls.now('king');
    ls.type('king');
    await wait(80);
    await ls.now('king');
    assert.equal(calls.length, 1);
    await ls.now('king', undefined, true);
    assert.equal(calls.length, 2);
  });

  it('the same text with another filter is another search', async () => {
    const { ls, calls } = make();
    await ls.now('king');
    await ls.now('king', 'video');
    ls.type('king', 'album');
    await wait(80);
    assert.deepEqual(calls, [['king', undefined], ['king', 'video'], ['king', 'album']]);
  });

  it('after an error the same search can be tried again', async () => {
    const { ls, calls, log } = make();
    await ls.now('boom');
    assert.deepEqual(log, ['start:boom', 'error:HTTP 500']);
    await ls.now('boom');
    assert.equal(calls.length, 2);
  });

  it('an empty box clears, cancels waiting searches and drops answers on their way', async () => {
    const { ls, calls, log } = make((_q) => 80);
    ls.type('king');
    await wait(60); // running now
    ls.type('');
    await wait(150);
    assert.deepEqual(calls.length, 1);
    assert.ok(log.includes('clear'));
    assert.ok(!log.some((l) => l.startsWith('result')));
    // typing the same text again searches again (nothing is shown for it)
    ls.type('king');
    await wait(60);
    assert.equal(calls.length, 2);
  });

  it('cancel() drops an answer on its way', async () => {
    const { ls, log } = make((_q) => 60);
    void ls.now('king');
    ls.cancel();
    await wait(120);
    assert.ok(!log.some((l) => l.startsWith('result')));
  });
});
