import { type BackupFile, BACKUP_APP, BACKUP_FORMAT } from '../core/backup';
import { type Rule, type SmartRules, sanitizeRules } from '../core/smart';
import type { Db } from './driver';
import * as repo from './repo';

/* ------------------------------------------------------------------ smart-playlist rules travel with tag NAMES ------------------------------------------------------------------ */
type PortableRule = Exclude<Rule, { field: 'tag' }> | { field: 'tag'; op: 'has' | 'hasNot'; tagName: string };

function toPortable(rules: SmartRules, tagName: Map<number, string>): unknown {
  return {
    ...rules,
    rules: rules.rules.flatMap((r): PortableRule[] => {
      if (r.field !== 'tag') return [r];
      const name = tagName.get(r.tagId);
      return name ? [{ field: 'tag', op: r.op, tagName: name }] : []; // a rule about a deleted tag has no meaning
    }),
  };
}

/** back to numbers of THIS phone's tags (a tag that does not exist yet is made) */
async function fromPortable(raw: unknown, tagId: (name: string) => Promise<number>): Promise<SmartRules> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rules: unknown[] = [];
  for (const r of Array.isArray(o.rules) ? o.rules.slice(0, 20) : []) {
    const q = r as Record<string, unknown> | null;
    if (q && typeof q === 'object' && q.field === 'tag') {
      const name = typeof q.tagName === 'string' ? q.tagName.trim().slice(0, 30) : '';
      if (name && (q.op === 'has' || q.op === 'hasNot')) rules.push({ field: 'tag', op: q.op, tagId: await tagId(name) });
    } else {
      rules.push(r);
    }
  }
  return sanitizeRules({ ...o, rules });
}

/* ------------------------------------------------------------------ export ------------------------------------------------------------------ */
interface SongRow {
  id: string;
  title: string;
  artistsText: string | null;
  durationText: string | null;
  thumbnailUrl: string | null;
  likedAt: number | null;
  totalPlayTimeMs: number;
}

/** the library as a backup (without preferences – the caller adds them). Files on the phone and their songs are not included. */
export async function exportLibrary(db: Db, opts: { events: boolean; appVersion: string; now?: Date }): Promise<BackupFile> {
  const referenced =
    'likedAt IS NOT NULL OR id IN (SELECT songId FROM SongPlaylistMap) OR id IN (SELECT songId FROM SongTag) OR id IN (SELECT songId FROM HotCue) OR id IN (SELECT songId FROM SongTrim) OR id IN (SELECT songId FROM SongBpm)';
  const songRows = await db.all<SongRow>(`SELECT id, title, artistsText, durationText, thumbnailUrl, likedAt, totalPlayTimeMs FROM Song WHERE id NOT LIKE 'local:%' ${opts.events ? '' : `AND (${referenced})`} ORDER BY title COLLATE NOCASE`);

  const playlists = [];
  for (const p of await db.all<{ id: number; name: string; browseId: string | null }>('SELECT id, name, browseId FROM Playlist ORDER BY id')) {
    const songs = await db.all<{ songId: string }>("SELECT songId FROM SongPlaylistMap WHERE playlistId = ? AND songId NOT LIKE 'local:%' ORDER BY position", [p.id]);
    playlists.push({ name: p.name, browseId: p.browseId, songs: songs.map((s) => s.songId) });
  }

  const tagRows = await repo.tags(db);
  const tagName = new Map(tagRows.map((t) => [t.id, t.name] as const));
  const tags = [];
  for (const t of tagRows) {
    const songs = await db.all<{ songId: string }>("SELECT songId FROM SongTag WHERE tagId = ? AND songId NOT LIKE 'local:%'", [t.id]);
    tags.push({ name: t.name, songs: songs.map((s) => s.songId) });
  }

  const smartPlaylists = (await repo.smartPlaylists(db)).map((p) => ({ name: p.name, rules: toPortable(p.rules, tagName) }));
  const hotCues = (await db.all<{ songId: string; slot: number; position: number; label: string | null }>("SELECT songId, slot, position, label FROM HotCue WHERE songId NOT LIKE 'local:%' ORDER BY songId, slot")).map((c) => ({ ...c }));
  const trims = (await db.all<{ songId: string; startSec: number | null; endSec: number | null }>("SELECT songId, startSec, endSec FROM SongTrim WHERE songId NOT LIKE 'local:%'")).map((t) => ({ ...t }));
  const bpm = (await db.all<{ songId: string; bpm: number; anchor: number | null }>("SELECT songId, bpm, anchor FROM SongBpm WHERE songId NOT LIKE 'local:%'")).map((b) => ({ songId: b.songId, bpm: b.bpm, ...(b.anchor !== null ? { anchor: b.anchor } : {}) }));
  const events = opts.events ? (await db.all<{ songId: string; timestamp: number; playTime: number }>("SELECT songId, timestamp, playTime FROM Event WHERE songId NOT LIKE 'local:%' ORDER BY id")).map((e) => ({ ...e })) : [];

  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    createdAt: (opts.now ?? new Date()).toISOString(),
    appVersion: opts.appVersion,
    songs: songRows.map((r) => ({ id: r.id, title: r.title, artists: r.artistsText, duration: r.durationText, thumbnail: r.thumbnailUrl, likedAt: r.likedAt, playMs: r.totalPlayTimeMs })),
    playlists,
    smartPlaylists,
    tags,
    hotCues,
    trims,
    bpm,
    events,
  };
}

/* ------------------------------------------------------------------ import: only ever ADDS ------------------------------------------------------------------ */
export interface ImportReport {
  songsNew: number;
  songsKnown: number;
  likedAdded: number;
  playlistsNew: number;
  playlistsMerged: number;
  playlistSongsAdded: number;
  smartNew: number;
  smartKept: number;
  tagsNew: number;
  tagsMerged: number;
  tagLinksAdded: number;
  cuesNew: number;
  trimsNew: number;
  bpmNew: number;
  eventsNew: number;
}

const emptyReport = (): ImportReport => ({ songsNew: 0, songsKnown: 0, likedAdded: 0, playlistsNew: 0, playlistsMerged: 0, playlistSongsAdded: 0, smartNew: 0, smartKept: 0, tagsNew: 0, tagsMerged: 0, tagLinksAdded: 0, cuesNew: 0, trimsNew: 0, bpmNew: 0, eventsNew: 0 });

/**
 * What a restore does, in one transaction (all or nothing):
 *  - songs you already have are kept (a favourite is added, the longer listening time is kept, empty details are filled in)
 *  - a playlist with the same name gets the missing songs at its end; others are created
 *  - a smart playlist with the same name and the same rules stays; with other rules it comes in as "名前（取り込み）"
 *  - tags are matched by name; cues, start/end, tempos and history that you already have are not changed
 */
async function apply(db: Db, b: BackupFile): Promise<ImportReport> {
  const rep = emptyReport();

  for (const s of b.songs) {
    const before = await db.first<{ likedAt: number | null }>('SELECT likedAt FROM Song WHERE id = ?', [s.id]);
    if (!before) {
      await db.run('INSERT INTO Song (id, title, artistsText, durationText, thumbnailUrl, likedAt, totalPlayTimeMs) VALUES (?,?,?,?,?,?,?)', [s.id, s.title, s.artists, s.duration, s.thumbnail, s.likedAt, s.playMs]);
      rep.songsNew++;
      if (s.likedAt) rep.likedAdded++;
    } else {
      rep.songsKnown++;
      if (before.likedAt === null && s.likedAt) rep.likedAdded++;
      await db.run('UPDATE Song SET likedAt = COALESCE(likedAt, ?), totalPlayTimeMs = MAX(totalPlayTimeMs, ?), artistsText = COALESCE(artistsText, ?), durationText = COALESCE(durationText, ?), thumbnailUrl = COALESCE(thumbnailUrl, ?) WHERE id = ?', [s.likedAt, s.playMs, s.artists, s.duration, s.thumbnail, s.id]);
    }
  }

  // tags first: smart playlists may refer to them
  const tagIds = new Map<string, number>(); // lower-case name → id
  for (const t of await repo.tags(db)) tagIds.set(t.name.toLowerCase(), t.id);
  const tagId = async (name: string): Promise<number> => {
    const key = name.toLowerCase();
    const have = tagIds.get(key);
    if (have !== undefined) return have;
    const id = await repo.createTag(db, name);
    tagIds.set(key, id);
    rep.tagsNew++;
    return id;
  };
  for (const t of b.tags) {
    const existed = tagIds.has(t.name.toLowerCase());
    const id = await tagId(t.name);
    if (existed) rep.tagsMerged++;
    for (const songId of t.songs) rep.tagLinksAdded += (await db.run('INSERT OR IGNORE INTO SongTag (songId, tagId) VALUES (?,?)', [songId, id])).changes;
  }

  const byName = new Map<string, number>();
  for (const p of await db.all<{ id: number; name: string }>('SELECT id, name FROM Playlist ORDER BY id')) if (!byName.has(p.name.toLowerCase())) byName.set(p.name.toLowerCase(), p.id);
  for (const p of b.playlists) {
    let id = byName.get(p.name.toLowerCase());
    if (id === undefined) {
      id = (await db.run('INSERT INTO Playlist (name, browseId) VALUES (?,?)', [p.name, p.browseId])).lastInsertRowId;
      byName.set(p.name.toLowerCase(), id);
      rep.playlistsNew++;
    } else {
      rep.playlistsMerged++;
    }
    let pos = ((await db.first<{ m: number }>('SELECT COALESCE(MAX(position), -1) AS m FROM SongPlaylistMap WHERE playlistId = ?', [id]))?.m ?? -1) + 1;
    for (const songId of p.songs) {
      const added = (await db.run('INSERT OR IGNORE INTO SongPlaylistMap (songId, playlistId, position) VALUES (?,?,?)', [songId, id, pos])).changes;
      if (added) {
        pos++;
        rep.playlistSongsAdded++;
      }
    }
  }

  const existing = await repo.smartPlaylists(db);
  const names = new Set(existing.map((p) => p.name.toLowerCase()));
  const rulesKey = (r: SmartRules) => JSON.stringify(r);
  for (const sp of b.smartPlaylists) {
    const rules = await fromPortable(sp.rules, tagId);
    const same = existing.find((p) => p.name.toLowerCase() === sp.name.toLowerCase());
    if (same && rulesKey(same.rules) === rulesKey(rules)) {
      rep.smartKept++;
      continue;
    }
    const name = same ? `${sp.name}（取り込み）`.slice(0, 40) : sp.name;
    if (names.has(name.toLowerCase())) {
      rep.smartKept++;
      continue;
    }
    await repo.saveSmartPlaylist(db, { name, rules });
    names.add(name.toLowerCase());
    rep.smartNew++;
  }

  for (const c of b.hotCues) rep.cuesNew += (await db.run('INSERT OR IGNORE INTO HotCue (songId, slot, position, label) VALUES (?,?,?,?)', [c.songId, c.slot, c.position, c.label])).changes;
  for (const t of b.trims) rep.trimsNew += (await db.run('INSERT OR IGNORE INTO SongTrim (songId, startSec, endSec) VALUES (?,?,?)', [t.songId, t.startSec, t.endSec])).changes;
  for (const t of b.bpm) rep.bpmNew += (await db.run('INSERT OR IGNORE INTO SongBpm (songId, bpm, anchor) VALUES (?,?,?)', [t.songId, t.bpm, t.anchor ?? null])).changes;
  for (const e of b.events) {
    rep.eventsNew += (await db.run('INSERT INTO Event (songId, timestamp, playTime) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM Event WHERE songId = ? AND timestamp = ?)', [e.songId, e.timestamp, e.playTime, e.songId, e.timestamp])).changes;
  }
  return rep;
}

class DryRun extends Error {
  constructor(readonly report: ImportReport) {
    super('dry run');
  }
}

/** Applies the backup. If anything fails, nothing is changed. */
export async function importLibrary(db: Db, backup: BackupFile): Promise<ImportReport> {
  return db.transaction(() => apply(db, backup));
}

/**
 * What importLibrary WOULD do. It runs the very same code and then undoes it, so the numbers shown before are the numbers
 * you get – and nothing changes.
 */
export async function previewImport(db: Db, backup: BackupFile): Promise<ImportReport> {
  try {
    await db.transaction(async () => {
      throw new DryRun(await apply(db, backup));
    });
  } catch (e) {
    if (e instanceof DryRun) return e.report;
    throw e;
  }
  throw new Error('unreachable');
}

/** "新しく 80曲、プレイリスト 2 に 14曲を追加…" – the report in words */
export function describeReport(r: ImportReport): string[] {
  const lines: string[] = [];
  if (r.songsNew || r.songsKnown) lines.push(`曲: 新しく ${r.songsNew}曲（すでにある ${r.songsKnown}曲）`);
  if (r.likedAdded) lines.push(`お気に入りに ${r.likedAdded}曲を追加`);
  if (r.playlistsNew || r.playlistsMerged) lines.push(`プレイリスト: 新しく ${r.playlistsNew}、同じ名前のものへ追加 ${r.playlistsMerged}（${r.playlistSongsAdded}曲を追加）`);
  if (r.smartNew || r.smartKept) lines.push(`スマートプレイリスト: 新しく ${r.smartNew}（同じものは ${r.smartKept}）`);
  if (r.tagsNew || r.tagsMerged) lines.push(`タグ: 新しく ${r.tagsNew}、同じ名前 ${r.tagsMerged}（${r.tagLinksAdded}曲に付与）`);
  if (r.cuesNew) lines.push(`ホットキュー ${r.cuesNew}`);
  if (r.trimsNew) lines.push(`スタート／エンド位置 ${r.trimsNew}`);
  if (r.bpmNew) lines.push(`BPM ${r.bpmNew}`);
  if (r.eventsNew) lines.push(`再生履歴 ${r.eventsNew}件`);
  return lines.length ? lines : ['追加するものは、ありません（すべて、すでにあります）'];
}
