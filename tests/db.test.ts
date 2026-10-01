import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

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

const song = (id: string, over: Partial<SongItem> = {}): SongItem => ({
  kind: 'song',
  id,
  title: `Title ${id}`,
  artists: [{ id: 'UC1', name: 'Artist One' }, { name: 'Plain' }],
  album: { id: 'MPREb_1', name: 'Album' },
  durationText: '3:00',
  thumbnail: `https://img/${id}`,
  explicit: false,
  ...over,
});

describe('repo', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('upserts songs without clobbering likes / play time', async () => {
    await repo.toggleLike(db, song('a'));
    await repo.recordPlay(db, song('a'), 5000);
    await repo.upsertSong(db, song('a', { title: 'Renamed' }));
    const row = await db.first<repo.SongRow>('SELECT * FROM Song WHERE id = ?', ['a']);
    assert.equal(row?.title, 'Renamed');
    assert.ok(row?.likedAt);
    assert.equal(row?.totalPlayTimeMs, 5000);
    assert.equal(row?.artistsText, 'Artist One, Plain');
  });

  it('stores explicit flag the way the Kotlin app does ("e:" prefix) and restores it', async () => {
    await repo.upsertSong(db, song('x', { explicit: true }));
    const raw = await db.first<{ title: string }>('SELECT title FROM Song WHERE id = ?', ['x']);
    assert.equal(raw?.title, 'e:Title x');
    const back = await repo.getSong(db, 'x');
    assert.equal(back?.explicit, true);
    assert.equal(back?.title, 'Title x');
  });

  it('toggles likes', async () => {
    assert.equal(await repo.toggleLike(db, song('a')), true);
    assert.deepEqual((await repo.likedSongs(db)).map((s) => s.id), ['a']);
    assert.equal(await repo.toggleLike(db, song('a')), false);
    assert.equal((await repo.likedSongs(db)).length, 0);
  });

  it('links albums and artists', async () => {
    await repo.upsertSong(db, song('a'));
    assert.equal((await db.all('SELECT * FROM SongAlbumMap')).length, 1);
    assert.equal((await db.all('SELECT * FROM SongArtistMap')).length, 1); // only the artist with an id
  });

  it('records history and stats, ignoring accidental skips', async () => {
    await repo.recordPlay(db, song('a'), 200); // < 1s -> ignored
    await repo.recordPlay(db, song('a'), 60_000);
    await repo.recordPlay(db, song('b'), 120_000);
    await repo.recordPlay(db, song('a'), 30_000);
    const top = await repo.topSongs(db, 'all');
    assert.deepEqual(top.map((t) => [t.song.id, t.playTimeMs, t.plays]), [['b', 120000, 1], ['a', 90000, 2]]);
    assert.equal(await repo.totalListeningMs(db, 'today'), 210_000);
    assert.equal((await repo.history(db))[0].id, 'a'); // most recently played first
    assert.equal(repo.formatPlayTime(90_000), '1m');
    assert.equal(repo.formatPlayTime(7_200_000), '2h');
    assert.equal(repo.formatPlayTime(3 * 86_400_000), '3d');
  });

  it('manages playlists (add, dedupe, reorder, remove, cascade delete)', async () => {
    const id = await repo.createPlaylist(db, 'Mix');
    assert.equal(await repo.addToPlaylist(db, id, [song('a'), song('b'), song('c')]), 3);
    assert.equal(await repo.addToPlaylist(db, id, [song('b'), song('d')]), 1); // b already there
    assert.deepEqual((await repo.playlistSongs(db, id)).map((s) => s.id), ['a', 'b', 'c', 'd']);

    await repo.movePlaylistSong(db, id, 'd', 0);
    assert.deepEqual((await repo.playlistSongs(db, id)).map((s) => s.id), ['d', 'a', 'b', 'c']);

    await repo.removeFromPlaylist(db, id, 'a');
    const list = await repo.playlists(db);
    assert.equal(list[0].songCount, 3);
    assert.equal(list[0].thumbnailUrl, 'https://img/d');

    await repo.renamePlaylist(db, id, 'Renamed');
    assert.equal((await repo.playlists(db))[0].name, 'Renamed');

    await repo.deletePlaylist(db, id);
    assert.equal((await db.all('SELECT * FROM SongPlaylistMap')).length, 0); // FK cascade
  });

  it('bookmarks albums / artists', async () => {
    const album = { kind: 'album', id: 'MPREb_9', title: 'X', artists: [{ name: 'Y' }], year: '2020' } as const;
    assert.equal(await repo.toggleAlbumBookmark(db, album), true);
    assert.equal((await repo.bookmarkedAlbums(db))[0].title, 'X');
    assert.equal(await repo.toggleAlbumBookmark(db, album), false);
    const artist = { kind: 'artist', id: 'UC9', name: 'Z' } as const;
    assert.equal(await repo.toggleArtistBookmark(db, artist), true);
    assert.equal((await repo.bookmarkedArtists(db))[0].name, 'Z');
  });

  it('keeps search history unique and most-recent-first', async () => {
    await repo.addSearchQuery(db, 'daft');
    await repo.addSearchQuery(db, 'daft punk');
    await repo.addSearchQuery(db, 'daft');
    assert.deepEqual(await repo.searchHistory(db, 'daft'), ['daft', 'daft punk']);
    await repo.deleteSearchQuery(db, 'daft');
    assert.deepEqual(await repo.searchHistory(db), ['daft punk']);
    await repo.clearSearchHistory(db);
    assert.deepEqual(await repo.searchHistory(db), []);
  });

  it('caches lyrics', async () => {
    await repo.cacheLyrics(db, song('a'), { source: 'lrclib', synced: true, lines: [{ time: 0, text: '' }, { time: 61500, text: 'hi' }], plain: 'hi' });
    const c = await repo.getCachedLyrics(db, 'a');
    assert.equal(c?.synced, '[01:01.50]hi');
    assert.equal(c?.fixed, 'hi');
  });
});
