import { type BpmInfo, validBpm } from '../core/beat';
import { type HotCue, type Trim, isCueSlot, sanitizeTrim } from '../core/dj';
import { LOCAL_ARTIST } from '../core/localMeta';
import { buildSmartQuery, likeContains, likePrefix, sanitizeRules, type SmartRules } from '../core/smart';
import type { AlbumItem, ArtistItem, Lyrics, SongItem } from '../core/types';
import type { Db, SqlValue } from './driver';

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

/**
 * "Recently played" for the home screen: written the moment a song STARTS (the Event history is only written when
 * a song ends, so the song you are listening to right now would be missing).
 */
export async function markPlayed(db: Db, song: SongItem): Promise<void> {
  await upsertSong(db, song);
  await db.run('INSERT OR REPLACE INTO RecentPlay (songId, playedAt) VALUES (?,?)', [song.id, now()]);
}

export async function recentSongs(db: Db, limit = 20): Promise<SongItem[]> {
  const rows = await db.all<SongRow>(
    'SELECT Song.* FROM RecentPlay JOIN Song ON Song.id = RecentPlay.songId ORDER BY RecentPlay.playedAt DESC, Song.rowid DESC LIMIT ?',
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

/** the history keeps this many searches; the oldest ones go */
export const SEARCH_HISTORY_LIMIT = 50;

export async function addSearchQuery(db: Db, query: string): Promise<void> {
  const q = query.trim().slice(0, 100);
  if (!q) return;
  await db.transaction(async () => {
    // Searching while typing saves "k", "ki", "kin" … – a new search that EXTENDS the latest entry replaces it instead of adding another
    const last = await db.first<{ id: number; query: string }>('SELECT id, `query` FROM SearchQuery ORDER BY id DESC LIMIT 1');
    if (last && q.length > last.query.length && q.toLowerCase().startsWith(last.query.toLowerCase())) {
      await db.run('DELETE FROM SearchQuery WHERE id = ?', [last.id]);
    }
    // move to top: delete + insert so AUTOINCREMENT id order == recency
    await db.run('DELETE FROM SearchQuery WHERE `query` = ? COLLATE NOCASE', [q]);
    await db.run('INSERT INTO SearchQuery (`query`) VALUES (?)', [q]);
    await db.run('DELETE FROM SearchQuery WHERE id NOT IN (SELECT id FROM SearchQuery ORDER BY id DESC LIMIT ?)', [SEARCH_HISTORY_LIMIT]);
  });
}

export async function searchHistory(db: Db, prefix = '', limit = SEARCH_HISTORY_LIMIT): Promise<string[]> {
  const rows = await db.all<{ query: string }>(
    "SELECT `query` FROM SearchQuery WHERE `query` LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?",
    [likePrefix(prefix), limit],
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

/* ------------------------------------------------------------------ *
 * Tags and smart playlists
 * ------------------------------------------------------------------ */

export interface TagRow {
  id: number;
  name: string;
  songCount: number;
}

const cleanTag = (name: string) => name.trim().slice(0, 30);

/** creates the tag, or returns the id of the one that already has this name (letter case ignored) */
export async function createTag(db: Db, name: string): Promise<number> {
  const n = cleanTag(name);
  if (!n) throw new Error('タグの名前を入力してください');
  const existing = await db.first<{ id: number }>('SELECT id FROM Tag WHERE name = ? COLLATE NOCASE', [n]);
  if (existing) return existing.id;
  return (await db.run('INSERT INTO Tag (name, createdAt) VALUES (?,?)', [n, now()])).lastInsertRowId;
}

export async function renameTag(db: Db, id: number, name: string): Promise<void> {
  const n = cleanTag(name);
  if (!n) throw new Error('タグの名前を入力してください');
  const clash = await db.first<{ id: number }>('SELECT id FROM Tag WHERE name = ? COLLATE NOCASE AND id <> ?', [n, id]);
  if (clash) throw new Error('同じ名前のタグがあります');
  await db.run('UPDATE Tag SET name = ? WHERE id = ?', [n, id]);
}

export async function deleteTag(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM Tag WHERE id = ?', [id]);
}

export async function tags(db: Db): Promise<TagRow[]> {
  return db.all<TagRow>(
    'SELECT Tag.id AS id, Tag.name AS name, COUNT(SongTag.songId) AS songCount FROM Tag LEFT JOIN SongTag ON SongTag.tagId = Tag.id GROUP BY Tag.id ORDER BY Tag.name COLLATE NOCASE',
  );
}

export async function tagIdsOfSong(db: Db, songId: string): Promise<number[]> {
  return (await db.all<{ tagId: number }>('SELECT tagId FROM SongTag WHERE songId = ?', [songId])).map((r) => r.tagId);
}

export async function setSongTag(db: Db, song: SongItem, tagId: number, on: boolean): Promise<void> {
  if (on) {
    await upsertSong(db, song);
    await db.run('INSERT OR IGNORE INTO SongTag (songId, tagId) VALUES (?,?)', [song.id, tagId]);
  } else {
    await db.run('DELETE FROM SongTag WHERE songId = ? AND tagId = ?', [song.id, tagId]);
  }
}

/** songs carrying ANY of the tags, or ALL of them */
export async function songsByTags(db: Db, tagIds: number[], mode: 'any' | 'all'): Promise<SongItem[]> {
  if (!tagIds.length) return [];
  const marks = tagIds.map(() => '?').join(',');
  const having = mode === 'all' ? `HAVING COUNT(DISTINCT SongTag.tagId) = ${tagIds.length}` : '';
  const rows = await db.all<SongRow>(
    `SELECT Song.* FROM Song JOIN SongTag ON SongTag.songId = Song.id WHERE SongTag.tagId IN (${marks}) GROUP BY Song.id ${having} ORDER BY Song.title COLLATE NOCASE`,
    tagIds,
  );
  return rows.map(songFromRow);
}

export interface SmartPlaylistRow {
  id: number;
  name: string;
  rules: SmartRules;
}

export async function smartPlaylists(db: Db): Promise<SmartPlaylistRow[]> {
  const rows = await db.all<{ id: number; name: string; rules: string }>('SELECT id, name, rules FROM SmartPlaylist ORDER BY name COLLATE NOCASE');
  return rows.map((r) => {
    let raw: unknown = null;
    try {
      raw = JSON.parse(r.rules);
    } catch {
      /* a damaged entry becomes "all songs" instead of breaking the list */
    }
    return { id: r.id, name: r.name, rules: sanitizeRules(raw) };
  });
}

export async function getSmartPlaylist(db: Db, id: number): Promise<SmartPlaylistRow | null> {
  return (await smartPlaylists(db)).find((p) => p.id === id) ?? null;
}

export async function saveSmartPlaylist(db: Db, p: { id?: number; name: string; rules: SmartRules }): Promise<number> {
  const name = p.name.trim().slice(0, 40) || 'スマートプレイリスト';
  const json = JSON.stringify(sanitizeRules(p.rules));
  if (p.id !== undefined) {
    await db.run('UPDATE SmartPlaylist SET name = ?, rules = ? WHERE id = ?', [name, json, p.id]);
    return p.id;
  }
  return (await db.run('INSERT INTO SmartPlaylist (name, rules, createdAt) VALUES (?,?,?)', [name, json, now()])).lastInsertRowId;
}

export async function deleteSmartPlaylist(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM SmartPlaylist WHERE id = ?', [id]);
}

/** the songs a smart playlist currently contains */
export async function smartSongs(db: Db, rules: SmartRules): Promise<SongItem[]> {
  const q = buildSmartQuery(sanitizeRules(rules), now());
  return (await db.all<SongRow>(q.sql, q.params)).map(songFromRow);
}

/* ------------------------------------------------------------------ *
 * Hot cues and start / end trim (per song)
 * ------------------------------------------------------------------ */

export async function hotCues(db: Db, songId: string): Promise<HotCue[]> {
  const rows = await db.all<{ slot: number; position: number; label: string | null }>('SELECT slot, position, label FROM HotCue WHERE songId = ? ORDER BY slot', [songId]);
  return rows.map((r) => ({ slot: r.slot, position: r.position, label: r.label ?? undefined }));
}

/** sets (or moves) the cue in a slot; the label of an existing cue is kept unless a new one is given */
export async function setHotCue(db: Db, song: SongItem, slot: number, position: number, label?: string): Promise<void> {
  if (!isCueSlot(slot)) throw new Error('キューの番号が正しくありません');
  if (!Number.isFinite(position) || position < 0) throw new Error('位置が正しくありません');
  await upsertSong(db, song);
  const keep = label === undefined ? ((await db.first<{ label: string | null }>('SELECT label FROM HotCue WHERE songId = ? AND slot = ?', [song.id, slot]))?.label ?? null) : label.trim().slice(0, 20) || null;
  await db.run('INSERT OR REPLACE INTO HotCue (songId, slot, position, label) VALUES (?,?,?,?)', [song.id, slot, position, keep]);
}

export async function deleteHotCue(db: Db, songId: string, slot: number): Promise<void> {
  await db.run('DELETE FROM HotCue WHERE songId = ? AND slot = ?', [songId, slot]);
}

export async function trimOf(db: Db, songId: string): Promise<Trim | null> {
  const r = await db.first<{ startSec: number | null; endSec: number | null }>('SELECT startSec, endSec FROM SongTrim WHERE songId = ?', [songId]);
  return r ? sanitizeTrim(r.startSec, r.endSec) : null;
}

/** null (or nothing left after checking) removes the trim */
export async function setTrim(db: Db, song: SongItem, trim: Trim | null): Promise<Trim | null> {
  const clean = trim ? sanitizeTrim(trim.startSec, trim.endSec, song.durationSec) : null;
  if (!clean) {
    await db.run('DELETE FROM SongTrim WHERE songId = ?', [song.id]);
    return null;
  }
  await upsertSong(db, song);
  await db.run('INSERT OR REPLACE INTO SongTrim (songId, startSec, endSec) VALUES (?,?,?)', [song.id, clean.startSec ?? null, clean.endSec ?? null]);
  return clean;
}

/* ------------------------------------------------------------------ *
 * Searching what is on the device (offline mode of the search)
 * ------------------------------------------------------------------ */

/** audio = saved songs; video = saved music videos (a picture comes with them); local = files imported from the device */
export type DownloadedKind = 'all' | 'audio' | 'video' | 'local';

/** every word has to appear in the title or the artist (so "king gnu aizo" finds King Gnu's AIZO); no words = everything */
function wordConditions(query: string, params: SqlValue[]): string[] {
  const words = query.split('\u3000').join(' ').split(' ').map((w) => w.trim()).filter(Boolean).slice(0, 6);
  return words.map((w) => {
    const p = likeContains(w);
    params.push(p, p);
    return "(Song.title LIKE ? ESCAPE '\\' OR Song.artistsText LIKE ? ESCAPE '\\')";
  });
}

export async function searchDownloaded(db: Db, query: string, kind: DownloadedKind = 'all', limit = 200): Promise<SongItem[]> {
  const found: { row: SongRow; at: number }[] = [];
  if (kind !== 'local') {
    const params: SqlValue[] = [];
    const where = wordConditions(query, params);
    if (kind === 'audio') where.push("(Offline.mimeType IS NULL OR Offline.mimeType NOT LIKE 'video/%')");
    if (kind === 'video') where.push("Offline.mimeType LIKE 'video/%'");
    const rows = await db.all<SongRow & { at: number }>(
      `SELECT Song.*, Offline.savedAt AS at FROM Offline JOIN Song ON Song.id = Offline.songId ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY Offline.savedAt DESC LIMIT ?`,
      [...params, limit],
    );
    found.push(...rows.map((row) => ({ row, at: row.at })));
  }
  if (kind === 'all' || kind === 'local') {
    const params: SqlValue[] = [];
    const where = wordConditions(query, params);
    const rows = await db.all<SongRow & { at: number }>(
      `SELECT Song.*, LocalFile.addedAt AS at FROM LocalFile JOIN Song ON Song.id = LocalFile.songId ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY LocalFile.addedAt DESC LIMIT ?`,
      [...params, limit],
    );
    found.push(...rows.map((row) => ({ row, at: row.at })));
  }
  found.sort((a, b) => b.at - a.at);
  return found.slice(0, limit).map((f) => songFromRow(f.row));
}

/* ------------------------------------------------------------------ *
 * Tempo (BPM) of a song – typed in or tapped by the person
 * ------------------------------------------------------------------ */

export async function bpmOf(db: Db, songId: string): Promise<BpmInfo | null> {
  const r = await db.first<{ bpm: number; anchor: number | null }>('SELECT bpm, anchor FROM SongBpm WHERE songId = ?', [songId]);
  return r && validBpm(r.bpm) ? { bpm: r.bpm, ...(r.anchor !== null && Number.isFinite(r.anchor) && r.anchor >= 0 ? { anchor: r.anchor } : {}) } : null;
}

/** saves (or, with null, removes) the tempo; a value that is not a usable BPM is refused */
export async function setBpm(db: Db, song: SongItem, info: BpmInfo | null): Promise<BpmInfo | null> {
  if (info === null) {
    await db.run('DELETE FROM SongBpm WHERE songId = ?', [song.id]);
    return null;
  }
  if (!validBpm(info.bpm)) throw new Error('BPM は 30〜300 の数字にしてください');
  const anchor = info.anchor !== undefined && Number.isFinite(info.anchor) && info.anchor >= 0 ? info.anchor : null;
  await upsertSong(db, song);
  await db.run('INSERT OR REPLACE INTO SongBpm (songId, bpm, anchor) VALUES (?,?,?)', [song.id, info.bpm, anchor]);
  return { bpm: info.bpm, ...(anchor !== null ? { anchor } : {}) };
}

/** the loudness stored for a song, or null – lets saved copies be evened out without the network */
export async function loudnessFor(db: Db, songId: string): Promise<number | null> {
  const r = await db.first<{ loudnessDb: number | null }>('SELECT loudnessDb FROM Format WHERE songId = ?', [songId]);
  return r?.loudnessDb ?? null;
}

/* ------------------------------------------------------------------ *
 * Local files (songs imported from the device)
 * ------------------------------------------------------------------ */

export async function addLocalFile(
  db: Db,
  f: { id: string; fileName: string; title: string; artist?: string; size?: number },
): Promise<SongItem> {
  await db.transaction(async () => {
    await db.run(
      'INSERT INTO Song (id, title, artistsText, durationText, thumbnailUrl, likedAt, totalPlayTimeMs) VALUES (?,?,?,NULL,NULL,NULL,0)',
      [f.id, f.title, f.artist ?? LOCAL_ARTIST],
    );
    await db.run('INSERT INTO LocalFile (songId, fileName, size, addedAt) VALUES (?,?,?,?)', [f.id, f.fileName, f.size ?? null, now()]);
  });
  return (await getSong(db, f.id)) as SongItem;
}

export async function localSongs(db: Db): Promise<SongItem[]> {
  const rows = await db.all<SongRow>(
    'SELECT Song.* FROM LocalFile JOIN Song ON Song.id = LocalFile.songId ORDER BY LocalFile.addedAt DESC, Song.title COLLATE NOCASE',
  );
  return rows.map(songFromRow);
}

export async function localFileName(db: Db, songId: string): Promise<string | null> {
  const r = await db.first<{ fileName: string }>('SELECT fileName FROM LocalFile WHERE songId = ?', [songId]);
  return r?.fileName ?? null;
}

/* ------------------------------------------------------------------ *
 * Offline copies of YouTube songs (kept inside the app, played instead of streaming)
 * ------------------------------------------------------------------ */

export interface OfflineRow {
  songId: string;
  fileName: string;
  size: number | null;
  mimeType: string | null;
  savedAt: number;
}

export async function addOffline(db: Db, song: SongItem, f: { fileName: string; size?: number; mimeType?: string }): Promise<void> {
  await upsertSong(db, song);
  await db.run('INSERT OR REPLACE INTO Offline (songId, fileName, size, mimeType, savedAt) VALUES (?,?,?,?,?)', [
    song.id,
    f.fileName,
    f.size ?? null,
    f.mimeType ?? null,
    now(),
  ]);
}

export async function offlineFile(db: Db, songId: string): Promise<OfflineRow | null> {
  return db.first<OfflineRow>('SELECT * FROM Offline WHERE songId = ?', [songId]);
}

export async function offlineIds(db: Db): Promise<string[]> {
  return (await db.all<{ songId: string }>('SELECT songId FROM Offline')).map((r) => r.songId);
}

/** saved songs, newest first */
export async function offlineSongs(db: Db): Promise<SongItem[]> {
  const rows = await db.all<SongRow>('SELECT Song.* FROM Offline JOIN Song ON Song.id = Offline.songId ORDER BY Offline.savedAt DESC, Song.title COLLATE NOCASE');
  return rows.map(songFromRow);
}

export async function offlineTotalSize(db: Db): Promise<number> {
  const r = await db.first<{ n: number | null }>('SELECT SUM(size) AS n FROM Offline');
  return r?.n ?? 0;
}

/** forgets the offline copy (the song itself stays in the library); returns the file name so the file can be deleted */
export async function deleteOffline(db: Db, songId: string): Promise<string | null> {
  const row = await offlineFile(db, songId);
  await db.run('DELETE FROM Offline WHERE songId = ?', [songId]);
  return row?.fileName ?? null;
}

export async function allOfflineFileNames(db: Db): Promise<string[]> {
  return (await db.all<{ fileName: string }>('SELECT fileName FROM Offline')).map((r) => r.fileName);
}

/** Android copies files out of the folder the user picked, so the originals stay: remember what was already imported. */
export async function isSourceImported(db: Db, sourceKey: string): Promise<boolean> {
  return !!(await db.first('SELECT 1 AS x FROM LocalImported WHERE sourceKey = ?', [sourceKey]));
}

export async function markSourceImported(db: Db, sourceKey: string): Promise<void> {
  await db.run('INSERT OR REPLACE INTO LocalImported (sourceKey, importedAt) VALUES (?,?)', [sourceKey, now()]);
}

/** Removes the song everywhere (playlists, history … via ON DELETE CASCADE); returns the stored file name so the file can be deleted too. */
export async function deleteLocalFile(db: Db, songId: string): Promise<string | null> {
  const name = await localFileName(db, songId);
  await db.run('DELETE FROM Song WHERE id = ?', [songId]);
  return name;
}
