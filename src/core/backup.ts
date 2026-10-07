import { type BpmInfo, validBpm } from './beat';
import { isCueSlot, sanitizeTrim } from './dj';

/**
 * The backup file: your library as one JSON file (favourites, playlists, smart playlists, tags, hot cues, start/end
 * positions, tempos, play history, and your preferences). It holds NO files (music saved on the phone) and NO secrets (keys).
 * A file can come from anywhere, so reading it checks every field and drops what is wrong – it never trusts it.
 */
export const BACKUP_APP = 'music-space';
export const BACKUP_FORMAT = 1;
export const MAX_BACKUP_CHARS = 60_000_000;

export interface BackupSong {
  id: string;
  /** as stored (an explicit song starts with "e:") */
  title: string;
  artists: string | null;
  duration: string | null;
  thumbnail: string | null;
  likedAt: number | null;
  playMs: number;
}
export interface BackupPlaylist {
  name: string;
  browseId: string | null;
  /** in order */
  songs: string[];
}
/** rules of a smart playlist, with tags by NAME (the numbers differ from phone to phone) */
export interface BackupSmart {
  name: string;
  rules: unknown;
}
export interface BackupTag {
  name: string;
  songs: string[];
}
export interface BackupCue {
  songId: string;
  slot: number;
  position: number;
  label: string | null;
}
export interface BackupTrim {
  songId: string;
  startSec: number | null;
  endSec: number | null;
}
export interface BackupBpm extends BpmInfo {
  songId: string;
}
export interface BackupEvent {
  songId: string;
  timestamp: number;
  playTime: number;
}
/** the colours you changed, kept apart for the dark and the light look */
export interface BackupTheme {
  mode?: 'system' | 'dark' | 'light';
  overrides?: { dark?: Record<string, string>; light?: Record<string, string> };
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  createdAt: string;
  appVersion: string;
  songs: BackupSong[];
  playlists: BackupPlaylist[];
  smartPlaylists: BackupSmart[];
  tags: BackupTag[];
  hotCues: BackupCue[];
  trims: BackupTrim[];
  bpm: BackupBpm[];
  events: BackupEvent[];
  settings?: Record<string, unknown>;
  theme?: BackupTheme;
}

/* ------------------------------------------------------------------ preferences ------------------------------------------------------------------ */
/** What a backup may carry of the settings – preferences only. Keys, servers, addresses and technical values are NOT here. */
export const RESTORABLE_SETTINGS: Record<string, (v: unknown) => boolean> = {
  hl: (v) => typeof v === 'string' && /^[A-Za-z-]{2,10}$/.test(v),
  gl: (v) => typeof v === 'string' && /^[A-Za-z]{2}$/.test(v),
  audioQuality: (v) => v === 'standard' || v === 'saver' || v === 'high',
  trendingCountry: (v) => typeof v === 'string' && /^[a-z]{2}$/.test(v),
  trendingLimit: (v) => v === 10 || v === 25 || v === 50 || v === 100,
  fadeSeconds: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 12,
  volumeNormalize: (v) => v === 'off' || v === 'light' || v === 'standard',
  resumeOnLaunch: (v) => typeof v === 'boolean',
  autoRadio: (v) => typeof v === 'boolean',
  autoLyrics: (v) => typeof v === 'boolean',
  playbackRate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.5 && v <= 2,
};

/** the settings that go into (or come out of) a backup */
export function pickSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, ok] of Object.entries(RESTORABLE_SETTINGS)) if (k in settings && ok(settings[k])) out[k] = settings[k];
  return out;
}

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v);

/* ------------------------------------------------------------------ reading ------------------------------------------------------------------ */
export type ParseResult = { ok: true; backup: BackupFile; warnings: string[] } | { ok: false; error: string };

const LIMIT = { songs: 100_000, playlists: 2_000, perList: 50_000, smart: 500, tags: 500, cues: 100_000, trims: 100_000, bpm: 100_000, events: 600_000 };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseBackup(raw: string): ParseResult {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, error: 'ファイルが空です' };
  if (raw.length > MAX_BACKUP_CHARS) return { ok: false, error: 'ファイルが大きすぎます' };
  let json: unknown;
  try {
    json = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return { ok: false, error: 'バックアップのファイルとして読み取れません（JSON ではありません）' };
  }
  const o = obj(json);
  if (!o || o.app !== BACKUP_APP) return { ok: false, error: 'Music space のバックアップではありません' };
  const format = num(o.format);
  if (format === null || format < 1) return { ok: false, error: 'バックアップの形式が正しくありません' };
  if (format > BACKUP_FORMAT) return { ok: false, error: '新しい版のアプリで作られたバックアップです。アプリを更新してから、もう一度お試しください' };

  const warnings: string[] = [];
  let dropped = 0;
  const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

  // songs first: everything else may only refer to songs that are here
  const songs: BackupSong[] = [];
  const known = new Set<string>();
  let local = 0;
  for (const s of list(o.songs, LIMIT.songs)) {
    const r = obj(s);
    const id = text(r?.id, 100);
    const title = text(r?.title, 300);
    if (!r || !id || !title) {
      dropped++;
      continue;
    }
    if (id.startsWith('local:')) {
      local++; // a file on the phone: the backup carries no files
      continue;
    }
    if (known.has(id)) continue;
    known.add(id);
    const liked = num(r.likedAt);
    const thumb = text(r.thumbnail, 500);
    songs.push({
      id,
      title,
      artists: text(r.artists, 500),
      duration: text(r.duration, 20),
      thumbnail: thumb && /^https?:\/\//.test(thumb) ? thumb : null,
      likedAt: liked !== null && liked > 0 ? Math.trunc(liked) : null,
      playMs: Math.max(0, Math.min(1e11, Math.trunc(num(r.playMs) ?? 0))),
    });
  }
  const ids = (v: unknown): string[] => {
    const seen = new Set<string>();
    for (const x of list(v, LIMIT.perList)) if (typeof x === 'string' && known.has(x)) seen.add(x);
    return [...seen];
  };

  const playlists: BackupPlaylist[] = [];
  for (const p of list(o.playlists, LIMIT.playlists)) {
    const r = obj(p);
    const name = text(r?.name, 100)?.trim();
    if (!r || !name) {
      dropped++;
      continue;
    }
    playlists.push({ name, browseId: text(r.browseId, 100), songs: ids(r.songs) });
  }

  const smartPlaylists: BackupSmart[] = [];
  for (const p of list(o.smartPlaylists, LIMIT.smart)) {
    const r = obj(p);
    const name = text(r?.name, 40)?.trim();
    if (!r || !name || JSON.stringify(r.rules ?? null).length > 20_000) {
      dropped++;
      continue;
    }
    smartPlaylists.push({ name, rules: r.rules });
  }

  const tags: BackupTag[] = [];
  for (const t of list(o.tags, LIMIT.tags)) {
    const r = obj(t);
    const name = text(r?.name, 30)?.trim();
    if (!r || !name) {
      dropped++;
      continue;
    }
    tags.push({ name, songs: ids(r.songs) });
  }

  const hotCues: BackupCue[] = [];
  const cueKeys = new Set<string>();
  for (const c of list(o.hotCues, LIMIT.cues)) {
    const r = obj(c);
    const pos = num(r?.position);
    const slot = num(r?.slot);
    const songId = typeof r?.songId === 'string' ? r.songId : '';
    if (!r || !known.has(songId) || slot === null || !isCueSlot(slot) || pos === null || pos < 0 || pos > 1e5 || cueKeys.has(`${songId}|${slot}`)) {
      dropped++;
      continue;
    }
    cueKeys.add(`${songId}|${slot}`);
    hotCues.push({ songId, slot, position: pos, label: text(r.label, 20) });
  }

  const trims: BackupTrim[] = [];
  const trimmed = new Set<string>();
  for (const t of list(o.trims, LIMIT.trims)) {
    const r = obj(t);
    const songId = typeof r?.songId === 'string' ? r.songId : '';
    const clean = r ? sanitizeTrim(num(r.startSec), num(r.endSec)) : null;
    if (!r || !known.has(songId) || !clean || trimmed.has(songId)) {
      dropped++;
      continue;
    }
    trimmed.add(songId);
    trims.push({ songId, startSec: clean.startSec ?? null, endSec: clean.endSec ?? null });
  }

  const bpm: BackupBpm[] = [];
  const tempoDone = new Set<string>();
  for (const b of list(o.bpm, LIMIT.bpm)) {
    const r = obj(b);
    const songId = typeof r?.songId === 'string' ? r.songId : '';
    const v = num(r?.bpm);
    if (!r || !known.has(songId) || v === null || !validBpm(v) || tempoDone.has(songId)) {
      dropped++;
      continue;
    }
    tempoDone.add(songId);
    const anchor = num(r.anchor);
    bpm.push({ songId, bpm: v, ...(anchor !== null && anchor >= 0 ? { anchor } : {}) });
  }

  const events: BackupEvent[] = [];
  for (const e of list(o.events, LIMIT.events)) {
    const r = obj(e);
    const songId = typeof r?.songId === 'string' ? r.songId : '';
    const ts = num(r?.timestamp);
    const play = num(r?.playTime);
    if (!r || !known.has(songId) || ts === null || ts <= 0 || play === null || play < 0 || play > 1e8) {
      dropped++;
      continue;
    }
    events.push({ songId, timestamp: Math.trunc(ts), playTime: Math.trunc(play) });
  }

  const backup: BackupFile = {
    app: BACKUP_APP,
    format,
    createdAt: text(o.createdAt, 40) ?? '',
    appVersion: text(o.appVersion, 20) ?? '',
    songs,
    playlists,
    smartPlaylists,
    tags,
    hotCues,
    trims,
    bpm,
    events,
  };

  const settings = obj(o.settings);
  if (settings) {
    const picked = pickSettings(settings);
    if (Object.keys(picked).length) backup.settings = picked;
  }
  const theme = obj(o.theme);
  if (theme) {
    const overrides: NonNullable<BackupTheme['overrides']> = {};
    for (const scheme of ['dark', 'light'] as const) {
      const colours: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj(obj(theme.overrides)?.[scheme]) ?? {}).slice(0, 40)) if (/^[A-Za-z][A-Za-z0-9]{0,29}$/.test(k) && isColor(v)) colours[k] = v;
      if (Object.keys(colours).length) overrides[scheme] = colours;
    }
    const mode = theme.mode === 'system' || theme.mode === 'dark' || theme.mode === 'light' ? theme.mode : undefined;
    if (mode || Object.keys(overrides).length) backup.theme = { ...(mode ? { mode } : {}), ...(Object.keys(overrides).length ? { overrides } : {}) };
  }

  if (local) warnings.push(`端末内のファイルの曲 ${local}件は、ファイルが含まれないので、読み込みません`);
  if (dropped) warnings.push(`形式が正しくない項目 ${dropped}件を、読み飛ばしました`);
  return { ok: true, backup, warnings };
}

/* ------------------------------------------------------------------ names and numbers for the screen ------------------------------------------------------------------ */
export function backupFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `musicspace-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/** which files in the backup folder are offered for restoring (any .json – a renamed file still works) */
export const isBackupFileName = (name: string): boolean => /\.json$/i.test(name) && name.length <= 200;

export interface BackupSummary {
  songs: number;
  playlists: number;
  smartPlaylists: number;
  tags: number;
  hotCues: number;
  bpm: number;
  events: number;
  settings: boolean;
}
export function summarizeBackup(b: BackupFile): BackupSummary {
  return { songs: b.songs.length, playlists: b.playlists.length, smartPlaylists: b.smartPlaylists.length, tags: b.tags.length, hotCues: b.hotCues.length, bpm: b.bpm.length, events: b.events.length, settings: Boolean(b.settings || b.theme) };
}

/** "120曲・プレイリスト 5・…" – what is in it, in words */
export function describeSummary(s: BackupSummary): string {
  const parts = [`${s.songs}曲`];
  if (s.playlists) parts.push(`プレイリスト ${s.playlists}`);
  if (s.smartPlaylists) parts.push(`スマート ${s.smartPlaylists}`);
  if (s.tags) parts.push(`タグ ${s.tags}`);
  if (s.hotCues) parts.push(`キュー ${s.hotCues}`);
  if (s.bpm) parts.push(`BPM ${s.bpm}`);
  if (s.events) parts.push(`再生履歴 ${s.events}件`);
  if (s.settings) parts.push('設定');
  return parts.join('・');
}
