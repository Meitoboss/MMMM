import { ArchiveError, ArchiveReader, ArchiveWriter, type ByteSink, type ByteSource, type KeyOptions } from './archive';
import { utf8Decode, utf8Encode } from './crypto/bytes';
import { isLocalId } from './localMeta';
import { extensionFor, safeFileStem } from './offlineJobs';
import type { SongItem } from './types';

/**
 * The saved songs, inside an encrypted archive (core/archive.ts): every saved song as the file it is (no conversion – the
 * sound is exactly what was saved), with what the app knows about it, and – if wanted – the library backup (playlists …).
 *
 * Everything that touches a phone (reading and writing files, the database) is passed in, so all of it can be tested.
 * What comes OUT of an archive is never trusted: the file name is made here from the song's id, ids and sizes are checked,
 * and what is not valid is skipped.
 */
export const REC_LIBRARY = 1;
export const REC_SONG = 2;
export const REC_MANIFEST = 3;
export const MAX_SONGS = 50_000;
export const MAX_SONG_BYTES = 1_500_000_000;
export const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MIMES = new Set(['audio/mp4', 'audio/webm', 'audio/ogg', 'video/mp4', 'audio/mpeg', 'audio/aac']);

export interface SongMeta {
  id: string;
  title: string;
  artists: string[];
  explicit: boolean;
  durationText: string | null;
  thumbnail: string | null;
  mimeType: string | null;
  loudnessDb: number | null;
}

export interface Manifest {
  app: 'music-space';
  kind: 'songs';
  version: 1;
  createdAt: string;
  appVersion: string;
  hasLibrary: boolean;
  /** the bytes of all the songs together */
  totalBytes: number;
  songs: { id: string; title: string; size: number }[];
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export const isValidSongId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id) && !isLocalId(id);

export function songMetaOf(song: SongItem, mimeType: string | null, loudnessDb: number | null): SongMeta {
  return {
    id: song.id,
    title: song.title,
    artists: song.artists.map((a) => a.name),
    explicit: song.explicit,
    durationText: song.durationText ?? null,
    thumbnail: song.thumbnail ?? null,
    mimeType,
    loudnessDb,
  };
}

/** checks and cleans what an archive says about a song; null when it cannot be a saved YouTube song */
export function parseSongMeta(meta: unknown): SongMeta | null {
  const m = rec(meta);
  if (!m || !isValidSongId(m.id)) return null;
  const title = str(m.title, 300);
  if (!title) return null;
  const mime = typeof m.mimeType === 'string' ? m.mimeType.split(';')[0].trim().toLowerCase() : '';
  const loud = typeof m.loudnessDb === 'number' && Number.isFinite(m.loudnessDb) && Math.abs(m.loudnessDb) <= 60 ? m.loudnessDb : null;
  const thumb = str(m.thumbnail, 500);
  return {
    id: m.id,
    title,
    artists: (Array.isArray(m.artists) ? m.artists : []).slice(0, 20).map((a) => str(a, 100)).filter((a): a is string => a !== null),
    explicit: m.explicit === true,
    durationText: str(m.durationText, 20),
    thumbnail: thumb && /^https?:\/\//.test(thumb) ? thumb : null,
    mimeType: MIMES.has(mime) ? mime : null,
    loudnessDb: loud,
  };
}

export function songFromMeta(m: SongMeta): SongItem {
  return {
    kind: 'song',
    id: m.id,
    title: m.title,
    artists: m.artists.map((name) => ({ name })),
    explicit: m.explicit,
    ...(m.durationText ? { durationText: m.durationText } : {}),
    ...(m.thumbnail ? { thumbnail: m.thumbnail } : {}),
  };
}

export function parseManifest(meta: unknown): Manifest | null {
  const m = rec(meta);
  if (!m || m.app !== 'music-space' || m.kind !== 'songs' || m.version !== 1 || !Array.isArray(m.songs) || m.songs.length > MAX_SONGS) return null;
  const songs: Manifest['songs'] = [];
  for (const s of m.songs) {
    const r = rec(s);
    if (!r || !isValidSongId(r.id) || typeof r.size !== 'number' || !Number.isFinite(r.size) || r.size < 0 || r.size > MAX_SONG_BYTES) continue;
    songs.push({ id: r.id, title: str(r.title, 300) ?? r.id, size: Math.trunc(r.size) });
  }
  return {
    app: 'music-space',
    kind: 'songs',
    version: 1,
    createdAt: str(m.createdAt, 40) ?? '',
    appVersion: str(m.appVersion, 20) ?? '',
    hasLibrary: m.hasLibrary === true,
    totalBytes: songs.reduce((a, s) => a + s.size, 0),
    songs,
  };
}

/** the name a restored song's file gets – made here, from the id and the type, never taken from the archive */
export const restoredFileName = (m: SongMeta): string => `${safeFileStem(m.id)}${extensionFor(m.mimeType ?? undefined)}`;

export interface Progress {
  /** songs done / all songs */
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  /** the song being worked on */
  title?: string;
}

/* ------------------------------------------------------------------ writing ------------------------------------------------------------------ */
export interface ExportSong {
  song: SongItem;
  fileName: string;
  mimeType: string | null;
  loudnessDb: number | null;
}
export interface ExportDeps extends KeyOptions {
  songs: ExportSong[];
  /** the size of a saved file now, or null when it is gone */
  fileSize(fileName: string): Promise<number | null>;
  openFile(fileName: string): Promise<{ source: ByteSource; close(): void | Promise<void> }>;
  /** the library backup as JSON text (playlists, tags …), if it should go along */
  library?: string;
  sink: ByteSink;
  secretKey: string;
  appVersion: string;
  now?: Date;
  iterations?: number;
  chunkSize?: number;
  random?: (n: number) => Uint8Array;
  onProgress?: (p: Progress) => void;
}
export interface ExportResult {
  included: number;
  /** saved songs whose file was gone */
  skipped: { id: string; title: string }[];
  bytes: number;
}

export async function exportSongArchive(deps: ExportDeps): Promise<ExportResult> {
  const items: { s: ExportSong; size: number }[] = [];
  const skipped: ExportResult['skipped'] = [];
  for (const s of deps.songs) {
    const size = await deps.fileSize(s.fileName);
    if (size === null || size < 1 || size > MAX_SONG_BYTES) skipped.push({ id: s.song.id, title: s.song.title });
    else items.push({ s, size });
  }
  if (items.length === 0 && !deps.library) throw new Error('保存した曲が、ありません');
  const library = deps.library ? utf8Encode(deps.library) : null;
  if (library && library.length > MAX_LIBRARY_BYTES) throw new Error('ライブラリの情報が大きすぎます');

  const total = items.length;
  const bytesTotal = items.reduce((a, i) => a + i.size, 0);
  const manifest: Manifest = {
    app: 'music-space',
    kind: 'songs',
    version: 1,
    createdAt: (deps.now ?? new Date()).toISOString(),
    appVersion: deps.appVersion,
    hasLibrary: library !== null,
    totalBytes: bytesTotal,
    songs: items.map((i) => ({ id: i.s.song.id, title: i.s.song.title, size: i.size })),
  };

  const writer = await ArchiveWriter.create(deps.sink, deps.secretKey, { iterations: deps.iterations, chunkSize: deps.chunkSize, random: deps.random, onKeyProgress: deps.onKeyProgress, isCancelled: deps.isCancelled });
  await writer.writeRecord(REC_MANIFEST, manifest, new Uint8Array(0));
  if (library) await writer.writeRecord(REC_LIBRARY, { kind: 'library' }, library);

  let bytesDone = 0;
  deps.onProgress?.({ done: 0, total, bytesDone, bytesTotal });
  for (let i = 0; i < items.length; i++) {
    if (deps.isCancelled?.()) throw new ArchiveError('cancelled', '中止しました');
    const { s, size } = items[i];
    const file = await deps.openFile(s.fileName);
    try {
      await writer.writeRecord(
        REC_SONG,
        songMetaOf(s.song, s.mimeType, s.loudnessDb),
        {
          size,
          source: file.source,
          onBytes: (n) => {
            bytesDone += n;
            deps.onProgress?.({ done: i, total, bytesDone, bytesTotal, title: s.song.title });
          },
        },
        deps.isCancelled,
      );
    } finally {
      await file.close();
    }
    deps.onProgress?.({ done: i + 1, total, bytesDone, bytesTotal, title: s.song.title });
  }
  await writer.finish();
  return { included: items.length, skipped, bytes: bytesTotal };
}

/* ------------------------------------------------------------------ reading ------------------------------------------------------------------ */
/** opens an archive and reads what is in it (the first records only: nothing else is read or decrypted yet) */
export async function openSongArchive(source: ByteSource, secretKey: string, opts: KeyOptions = {}): Promise<{ reader: ArchiveReader; manifest: Manifest }> {
  const reader = await ArchiveReader.open(source, secretKey, opts);
  const first = await reader.next();
  if (!first || first.type !== REC_MANIFEST) throw new ArchiveError('unsupported', 'このファイルの形式には、対応していません');
  const manifest = parseManifest(first.meta);
  if (!manifest) throw new ArchiveError('corrupt', 'ファイルが途中で切れているか、壊れています');
  return { reader, manifest };
}

export interface RestoreDeps {
  reader: ArchiveReader;
  manifest: Manifest;
  /** is this song already saved (the row AND the file)? */
  hasSong(id: string): Promise<boolean>;
  /** a file to write into; nothing is visible under its name until `commit`; `abort` leaves nothing behind (also after commit) */
  beginFile(fileName: string): Promise<{ sink: ByteSink; commit(): Promise<void>; abort(): Promise<void> }>;
  /** tells the database about the file (after it has been committed) */
  saveSong(meta: SongMeta, file: { fileName: string; size: number }): Promise<void>;
  importLibrary?(json: string): Promise<void>;
  onProgress?: (p: Progress) => void;
  isCancelled?: () => boolean;
}
export interface RestoreResult {
  restored: number;
  alreadyHad: number;
  /** records that could not be a song (a wrong id, a size that makes no sense …) */
  invalid: number;
  libraryRestored: boolean;
  libraryError?: string;
  bytes: number;
}

export async function restoreSongArchive(deps: RestoreDeps): Promise<RestoreResult> {
  const res: RestoreResult = { restored: 0, alreadyHad: 0, invalid: 0, libraryRestored: false, bytes: 0 };
  const total = deps.manifest.songs.length;
  const bytesTotal = deps.manifest.totalBytes;
  let done = 0;
  let bytesDone = 0;
  const progress = (title?: string) => deps.onProgress?.({ done, total, bytesDone, bytesTotal, title });
  progress();

  for (let r = await deps.reader.next(); r; r = await deps.reader.next()) {
    if (deps.isCancelled?.()) throw new ArchiveError('cancelled', '中止しました');
    if (r.type === REC_LIBRARY) {
      if (!deps.importLibrary || r.size > MAX_LIBRARY_BYTES) {
        await r.skip();
        continue;
      }
      const text = utf8Decode(await r.readAll());
      try {
        await deps.importLibrary(text);
        res.libraryRestored = true;
      } catch (e) {
        res.libraryError = e instanceof Error ? e.message : String(e);
      }
      continue;
    }
    if (r.type !== REC_SONG) {
      await r.skip(); // something a newer version added: not for us
      continue;
    }
    const meta = parseSongMeta(r.meta);
    if (!meta || r.size < 1 || r.size > MAX_SONG_BYTES) {
      res.invalid++;
      await r.skip();
      done++;
      progress();
      continue;
    }
    if (await deps.hasSong(meta.id)) {
      res.alreadyHad++;
      bytesDone += r.size;
      await r.skip();
      done++;
      progress(meta.title);
      continue;
    }
    const fileName = restoredFileName(meta);
    const out = await deps.beginFile(fileName);
    try {
      let written = 0;
      for (;;) {
        if (deps.isCancelled?.()) throw new ArchiveError('cancelled', '中止しました');
        const piece = await r.read(64 * 1024);
        if (piece.length === 0) break;
        await out.sink.write(piece);
        written += piece.length;
        bytesDone += piece.length;
        progress(meta.title);
      }
      if (written !== r.size) throw new ArchiveError('corrupt', 'ファイルが途中で切れているか、壊れています');
      await out.commit();
      await deps.saveSong(meta, { fileName, size: written });
    } catch (e) {
      await out.abort().catch(() => undefined); // never leave a half-written file, or one the database does not know about
      throw e;
    }
    res.restored++;
    res.bytes += r.size;
    done++;
    progress(meta.title);
  }
  return res;
}

/* ------------------------------------------------------------------ names and numbers for the screen ------------------------------------------------------------------ */
export function songArchiveFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `musicspace-songs-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.msbx`;
}
/** which files are offered for restoring (a system that adds ".bin" to an unknown type is allowed for) */
export const isSongArchiveName = (name: string): boolean => /\.msbx(\.bin)?$/i.test(name) && name.length <= 200;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** a rough time on a phone, in seconds: making the key (about 5 s) plus the bytes at about 3 MB a second */
export const estimateSeconds = (bytes: number): number => 5 + Math.ceil(Math.max(0, bytes) / 3_000_000);

export function formatDuration(sec: number): string {
  if (sec < 60) return '1分未満';
  const m = Math.round(sec / 60);
  if (m < 60) return `約${m}分`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `約${h}時間` : `約${h}時間${m % 60}分`;
}

/** the room needed to restore (the songs, and a little more for the file being written), or to write (the archive is as big as the songs) */
export const spaceNeeded = (bytes: number): number => Math.ceil(bytes * 1.02) + 10 * 1024 * 1024;
