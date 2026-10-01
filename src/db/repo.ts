import type { AlbumItem, ArtistItem, Lyrics, SongItem } from '../core/types';
import type { Db } from './driver';

/* ------------------------------------------------------------------ *
 * Row types (match the Room entities)
 * ------------------------------------------------------------------ */

export interface SongRow {
  id: string;
  title: string;
  artistsText: string | null;
  durationText: string | null;
  thumbnailUrl: string | null;
  likedAt: number | null;
  totalPlayTimeMs: number;
}

export interface PlaylistRow {
  id: number;
  name: string;
  browseId: string | null;
  songCount?: number;
  thumbnailUrl?: string | null;
}

export function songFromRow(r: SongRow): SongItem {
  return {
    kind: 'song',
    id: r.id,
    title: r.title.replace(/^e:/, ''),
    artists: r.artistsText ? r.artistsText.split(', ').map((name) => ({ name })) : [],
    durationText: r.durationText ?? undefined,
    thumbnail: r.thumbnailUrl ?? undefined,
    explicit: r.title.startsWith('e:'),
  };
}

const now = () => Date.now();

/** `Song.formattedTotalPlayTime` */
export function formatPlayTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  if (hours === 0) return `${Math.floor(seconds / 60)}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* ------------------------------------------------------------------ *
 * Songs
 * ------------------------------------------------------------------ */

/**
 * Insert-or-refresh a song and its album / artist links, without touching `likedAt` or play time.
 * (`@Insert(onConflict = IGNORE)` + update in Room.)
 */
export async function upsertSong(db: Db, s: SongItem): Promise<void> {
  const artistsText = s.artists.map((a) => a.name).join(', ') || null;
  // The Kotlin app stores explicit songs with an "e:" title prefix (see SongItem.from -> explicitBadge)
  const title = s.explicit && !s.title.startsWith('e:') ? `e:${s.title}` : s.title;
  await db.transaction(async () => {
    await db.run(
      'INSERT OR IGNORE INTO Song (id, title, artistsText, durationText, thumbnailUrl, likedAt, totalPlayTimeMs) VALUES (?,?,?,?,?,NULL,0)',
      [s.id, title, artistsText, s.durationText ?? null, s.thumbnail ?? null],
    );
    await db.run(
      'UPDATE Song SET title = ?, artistsText = COALESCE(?, artistsText), durationText = COALESCE(?, durationText), thumbnailUrl = COALESCE(?, thumbnailUrl) WHERE id = ?',
      [title, artistsText, s.durationText ?? null, s.thumbnail ?? null, s.id],
    );
    if (s.album?.id) {
      await db.run('INSERT OR IGNORE INTO Album (id, title, thumbnailUrl, timestamp) VALUES (?,?,?,?)', [
        s.album.id,
        s.album.name,
        s.thumbnail ?? null,
        now(),
      ]);
      await db.run('INSERT OR IGNORE INTO SongAlbumMap (songId, albumId, position) VALUES (?,?,NULL)', [
        s.id,
        s.album.id,
      ]);
    }
    for (const a of s.artists) {
      if (!a.id) continue;
      await db.run('INSERT OR IGNORE INTO Artist (id, name, timestamp) VALUES (?,?,?)', [a.id, a.name, now()]);
      await db.run('INSERT OR IGNORE INTO SongArtistMap (songId, artistId) VALUES (?,?)', [s.id, a.id]);
    }
  });
}

export async function getSong(db: Db, id: string): Promise<SongItem | null> {
  const r = await db.first<SongRow>('SELECT * FROM Song WHERE id = ?', [id]);
  return r ? songFromRow(r) : null;
}

export async function isLiked(db: Db, id: string): Promise<boolean> {
  const r = await db.first<{ likedAt: number | null }>('SELECT likedAt FROM Song WHERE id = ?', [id]);
  return !!r?.likedAt;
}

/** `Song.toggleLike()` – returns the new state. */
export async function toggleLike(db: Db, song: SongItem): Promise<boolean> {
  await upsertSong(db, song);
  const liked = await isLiked(db, song.id);
  await db.run('UPDATE Song SET likedAt = ? WHERE id = ?', [liked ? null : now(), song.id]);
  return !liked;
}

export async function likedSongs(db: Db): Promise<SongItem[]> {
  const rows = await db.all<SongRow>('SELECT * FROM Song WHERE likedAt IS NOT NULL ORDER BY likedAt DESC');
  return rows.map(songFromRow);
}

export async function allSongs(db: Db, orderBy: 'title' | 'recent' | 'plays' = 'title'): Promise<SongItem[]> {
  const order =
    orderBy === 'title'
      ? 'title COLLATE NOCASE ASC'
      : orderBy === 'plays'
        ? 'totalPlayTimeMs DESC'
        : '(SELECT MAX(timestamp) FROM Event WHERE songId = Song.id) DESC';
  const rows = await db.all<SongRow>(
    `SELECT * FROM Song WHERE totalPlayTimeMs > 0 OR likedAt IS NOT NULL OR id IN (SELECT songId FROM SongPlaylistMap) ORDER BY ${order}`,
  );
  return rows.map(songFromRow);
}

/* ------------------------------------------------------------------ *
 * Listening history & statistics (Event table)
 * ------------------------------------------------------------------ */

export async function recordPlay(db: Db, song: SongItem, playTimeMs: number): Promise<void> {
  if (playTimeMs < 1000) return; // ignore accidental skips
  await upsertSong(db, song);
  await db.transaction(async () => {
    await db.run('INSERT INTO Event (songId, timestamp, playTime) VALUES (?,?,?)', [song.id, now(), Math.round(playTimeMs)]);
    await db.run('UPDATE Song SET totalPlayTimeMs = totalPlayTimeMs + ? WHERE id = ?', [Math.round(playTimeMs), song.id]);
  });
}

export async function history(db: Db, limit = 100): Promise<SongItem[]> {
  const rows = await db.all<SongRow>(
    'SELECT Song.* FROM Song JOIN (SELECT songId, MAX(timestamp) AS t FROM Event GROUP BY songId) e ON e.songId = Song.id ORDER BY e.t DESC LIMIT ?',
    [limit],
  );
  return rows.map(songFromRow);
}

export type StatsRange = 'today' | 'week' | 'month' | '3months' | '6months' | 'year' | 'all';

const DAY = 86_400_000;
const RANGE_MS: Record<Exclude<StatsRange, 'all'>, number> = {
  today: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
  '3months': 90 * DAY,
  '6months': 182 * DAY,
  year: 365 * DAY,
};

export interface TopSong {
  song: SongItem;
  playTimeMs: number;
  plays: number;
}

/** Listening statistics screen (stat-today / week / month / … icons in assets/icons). */
export async function topSongs(db: Db, range: StatsRange, limit = 50): Promise<TopSong[]> {
  const since = range === 'all' ? 0 : now() - RANGE_MS[range];
  const rows = await db.all<SongRow & { pt: number; plays: number }>(
    'SELECT Song.*, SUM(Event.playTime) AS pt, COUNT(Event.id) AS plays FROM Event JOIN Song ON Song.id = Event.songId WHERE Event.timestamp >= ? GROUP BY Song.id ORDER BY pt DESC LIMIT ?',
    [since, limit],
  );
  return rows.map((r) => ({ song: songFromRow(r), playTimeMs: r.pt, plays: r.plays }));
}

export async function totalListeningMs(db: Db, range: StatsRange): Promise<number> {
  const since = range === 'all' ? 0 : now() - RANGE_MS[range];
  const r = await db.first<{ t: number | null }>('SELECT SUM(playTime) AS t FROM Event WHERE timestamp >= ?', [since]);
  return r?.t ?? 0;
}

/* ------------------------------------------------------------------ *
 * Playlists
 * ------------------------------------------------------------------ */

export async function createPlaylist(db: Db, name: string, browseId?: string): Promise<number> {
  const r = await db.run('INSERT INTO Playlist (name, browseId) VALUES (?,?)', [name, browseId ?? null]);
  return r.lastInsertRowId;
}

export async function renamePlaylist(db: Db, id: number, name: string): Promise<void> {
  await db.run('UPDATE Playlist SET name = ? WHERE id = ?', [name, id]);
}

export async function deletePlaylist(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM Playlist WHERE id = ?', [id]);
}

export async function playlists(db: Db): Promise<PlaylistRow[]> {
  return db.all<PlaylistRow>(
    `SELECT Playlist.*, COUNT(m.songId) AS songCount,
            (SELECT s.thumbnailUrl FROM SongPlaylistMap sm JOIN Song s ON s.id = sm.songId WHERE sm.playlistId = Playlist.id ORDER BY sm.position LIMIT 1) AS thumbnailUrl
       FROM Playlist LEFT JOIN SongPlaylistMap m ON m.playlistId = Playlist.id
      GROUP BY Playlist.id ORDER BY Playlist.name COLLATE NOCASE`,
  );
}

export async function addToPlaylist(db: Db, playlistId: number, songs: SongItem[]): Promise<number> {
  let added = 0;
  await db.transaction(async () => {
    const row = await db.first<{ p: number | null }>('SELECT MAX(position) AS p FROM SongPlaylistMap WHERE playlistId = ?', [playlistId]);
    let pos = (row?.p ?? -1) + 1;
    for (const s of songs) {
      await upsertSong(db, s);
      const r = await db.run('INSERT OR IGNORE INTO SongPlaylistMap (songId, playlistId, position) VALUES (?,?,?)', [s.id, playlistId, pos]);
      if (r.changes > 0) {
        pos++;
        added++;
      }
    }
  });
  return added;
}

export async function removeFromPlaylist(db: Db, playlistId: number, songId: string): Promise<void> {
  await db.run('DELETE FROM SongPlaylistMap WHERE playlistId = ? AND songId = ?', [playlistId, songId]);
}

export async function playlistSongs(db: Db, playlistId: number): Promise<SongItem[]> {
  const rows = await db.all<SongRow>(
    'SELECT Song.* FROM SongPlaylistMap m JOIN Song ON Song.id = m.songId WHERE m.playlistId = ? ORDER BY m.position',
    [playlistId],
  );
  return rows.map(songFromRow);
}

/** Move a song to a new index (drag & drop reorder). */
export async function movePlaylistSong(db: Db, playlistId: number, songId: string, newIndex: number): Promise<void> {
  const ids = (await playlistSongs(db, playlistId)).map((s) => s.id).filter((id) => id !== songId);
  ids.splice(Math.max(0, Math.min(newIndex, ids.length)), 0, songId);
  await db.transaction(async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.run('UPDATE SongPlaylistMap SET position = ? WHERE playlistId = ? AND songId = ?', [i, playlistId, ids[i]]);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Bookmarked albums / artists
 * ------------------------------------------------------------------ */

export async function toggleAlbumBookmark(db: Db, a: AlbumItem): Promise<boolean> {
  await db.run('INSERT OR IGNORE INTO Album (id, title, thumbnailUrl, year, authorsText, timestamp) VALUES (?,?,?,?,?,?)', [
    a.id,
    a.title,
    a.thumbnail ?? null,
    a.year ?? null,
    a.artists.map((x) => x.name).join(', ') || null,
    now(),
  ]);
  const cur = await db.first<{ bookmarkedAt: number | null }>('SELECT bookmarkedAt FROM Album WHERE id = ?', [a.id]);
  const next = cur?.bookmarkedAt ? null : now();
  await db.run('UPDATE Album SET bookmarkedAt = ? WHERE id = ?', [next, a.id]);
  return next !== null;
}

export async function bookmarkedAlbums(db: Db): Promise<AlbumItem[]> {
  const rows = await db.all<{ id: string; title: string | null; thumbnailUrl: string | null; year: string | null; authorsText: string | null }>(
    'SELECT * FROM Album WHERE bookmarkedAt IS NOT NULL ORDER BY bookmarkedAt DESC',
  );
  return rows.map((r) => ({
    kind: 'album',
    id: r.id,
    title: r.title ?? '',
    artists: r.authorsText ? r.authorsText.split(', ').map((name) => ({ name })) : [],
    year: r.year ?? undefined,
    thumbnail: r.thumbnailUrl ?? undefined,
  }));
}

export async function toggleArtistBookmark(db: Db, a: ArtistItem): Promise<boolean> {
  await db.run('INSERT OR IGNORE INTO Artist (id, name, thumbnailUrl, timestamp) VALUES (?,?,?,?)', [a.id, a.name, a.thumbnail ?? null, now()]);
  const cur = await db.first<{ bookmarkedAt: number | null }>('SELECT bookmarkedAt FROM Artist WHERE id = ?', [a.id]);
  const next = cur?.bookmarkedAt ? null : now();
  await db.run('UPDATE Artist SET bookmarkedAt = ? WHERE id = ?', [next, a.id]);
  return next !== null;
}

export async function bookmarkedArtists(db: Db): Promise<ArtistItem[]> {
  const rows = await db.all<{ id: string; name: string | null; thumbnailUrl: string | null }>(
    'SELECT * FROM Artist WHERE bookmarkedAt IS NOT NULL ORDER BY bookmarkedAt DESC',
  );
  return rows.map((r) => ({ kind: 'artist', id: r.id, name: r.name ?? '', thumbnail: r.thumbnailUrl ?? undefined }));
}

/* ------------------------------------------------------------------ *
 * Search history
 * ------------------------------------------------------------------ */

export async function addSearchQuery(db: Db, query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  // move to top: delete + insert so AUTOINCREMENT id order == recency
  await db.transaction(async () => {
    await db.run('DELETE FROM SearchQuery WHERE `query` = ?', [q]);
    await db.run('INSERT INTO SearchQuery (`query`) VALUES (?)', [q]);
  });
}

export async function searchHistory(db: Db, prefix = '', limit = 10): Promise<string[]> {
  const rows = await db.all<{ query: string }>(
    'SELECT `query` FROM SearchQuery WHERE `query` LIKE ? ORDER BY id DESC LIMIT ?',
    [`${prefix.replace(/[%_]/g, '')}%`, limit],
  );
  return rows.map((r) => r.query);
}

export async function deleteSearchQuery(db: Db, query: string): Promise<void> {
  await db.run('DELETE FROM SearchQuery WHERE `query` = ?', [query]);
}

export async function clearSearchHistory(db: Db): Promise<void> {
  await db.run('DELETE FROM SearchQuery');
}

/* ------------------------------------------------------------------ *
 * Lyrics cache (Lyrics table: `fixed` = user-edited plain text, `synced` = LRC)
 * ------------------------------------------------------------------ */

export async function saveLyrics(db: Db, song: SongItem, l: { fixed?: string | null; synced?: string | null }): Promise<void> {
  await upsertSong(db, song);
  await db.run('INSERT OR IGNORE INTO Lyrics (songId, fixed, synced) VALUES (?,NULL,NULL)', [song.id]);
  if (l.fixed !== undefined) await db.run('UPDATE Lyrics SET fixed = ? WHERE songId = ?', [l.fixed, song.id]);
  if (l.synced !== undefined) await db.run('UPDATE Lyrics SET synced = ? WHERE songId = ?', [l.synced, song.id]);
}

export async function getCachedLyrics(db: Db, songId: string): Promise<{ fixed: string | null; synced: string | null } | null> {
  return db.first('SELECT fixed, synced FROM Lyrics WHERE songId = ?', [songId]);
}

/** Convenience for storing a freshly downloaded `Lyrics` object. */
export async function cacheLyrics(db: Db, song: SongItem, lyrics: Lyrics): Promise<void> {
  const lrc = lyrics.synced
    ? lyrics.lines
        .filter((x) => x.time > 0 || x.text)
        .map((x) => {
          const m = Math.floor(x.time / 60000);
          const s = ((x.time % 60000) / 1000).toFixed(2).padStart(5, '0');
          return `[${String(m).padStart(2, '0')}:${s}]${x.text}`;
        })
        .join('\n')
    : null;
  await saveLyrics(db, song, { synced: lrc, fixed: lyrics.plain ?? undefined });
}

/* ------------------------------------------------------------------ *
 * Format (stream info cache used by the loudness normalizer)
 * ------------------------------------------------------------------ */

export async function saveFormat(
  db: Db,
  song: SongItem,
  f: { itag?: number; mimeType?: string; bitrate?: number; contentLength?: number; loudnessDb?: number },
): Promise<void> {
  await upsertSong(db, song);
  await db.run(
    'INSERT OR REPLACE INTO Format (songId, itag, mimeType, bitrate, contentLength, lastModified, loudnessDb) VALUES (?,?,?,?,?,?,?)',
    [song.id, f.itag ?? null, f.mimeType ?? null, f.bitrate ?? null, f.contentLength ?? null, now(), f.loudnessDb ?? null],
  );
}
