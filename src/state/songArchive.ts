import { create } from 'zustand';

import { APP_VERSION } from '../appVersion';
import { ArchiveError, type ArchiveReader, peekArchive } from '../core/archive';
import { exportAudioFiles } from '../core/audioExport';
import type { PickItem } from '../core/songPick';
import { type Manifest, type RestoreResult, exportSongArchive, formatBytes, openSongArchive, restoreSongArchive, songArchiveFileName, spaceNeeded } from '../core/songArchive';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { applyLibraryJson, hasOfflineRow, libraryAsJson, listExportSongs, saveRestoredSong } from '../db/songArchive';
import { type ArchiveOutput, createArchiveOutput, freeDiskBytes, offlineOps, openArchiveInput, createAudioOutput } from '../player/songArchivePlatform';
import type { BackupEntry } from '../player/backupFiles';
import { useLikes } from './likes';
import { useOffline } from './offline';

/**
 * Saved songs ↔ an encrypted file. One job at a time. The phone does the heavy part (the cipher runs in JavaScript,
 * about 3 MB a second), so a job shows its progress and can be cancelled; a cancelled or failed job leaves no half file.
 */
export type ArchivePhase = 'idle' | 'key' | 'writing' | 'reading';
interface ArchiveStore {
  phase: ArchivePhase;
  /** making the key from the secret key, 0 … 1 */
  keyProgress: number;
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  title: string;
  cancelRequested: boolean;
  cancel: () => void;
}

const IDLE = { phase: 'idle' as ArchivePhase, keyProgress: 0, done: 0, total: 0, bytesDone: 0, bytesTotal: 0, title: '', cancelRequested: false };
export const useSongArchive = create<ArchiveStore>((set, get) => ({ ...IDLE, cancel: () => get().phase !== 'idle' && set({ cancelRequested: true }) }));
const s = () => useSongArchive.getState();
const isCancelled = () => s().cancelRequested;
const start = (phase: ArchivePhase) => {
  if (s().phase !== 'idle') throw new Error('ほかの作業が、まだ続いています');
  useSongArchive.setState({ ...IDLE, phase });
};
const finish = () => useSongArchive.setState({ ...IDLE });

/** what a failure should say */
export function archiveErrorText(e: unknown): string {
  return e instanceof ArchiveError || e instanceof Error ? e.message : String(e);
}
export const isCancelledError = (e: unknown): boolean => e instanceof ArchiveError && e.code === 'cancelled';
export const isWrongKeyError = (e: unknown): boolean => e instanceof ArchiveError && e.code === 'wrong-key';

/** how many songs are saved, and how big they are together */
export async function savedSongsSummary(): Promise<{ count: number; bytes: number }> {
  const db = await openDb();
  const songs = await listExportSongs(db);
  const ops = await offlineOps();
  let bytes = 0;
  let count = 0;
  for (const x of songs) {
    const size = await ops.fileSize(x.fileName);
    if (size !== null) {
      bytes += size;
      count++;
    }
  }
  return { count, bytes };
}

/** the saved songs whose file is really there, as the list the person chooses from */
export async function listSavedForPick(): Promise<PickItem[]> {
  const db = await openDb();
  const ops = await offlineOps();
  const out: PickItem[] = [];
  for (const x of await listExportSongs(db)) {
    const size = await ops.fileSize(x.fileName);
    if (size !== null) out.push({ id: x.song.id, title: x.song.title, artist: x.song.artists.map((a) => a.name).join(', '), bytes: size });
  }
  return out;
}

export interface CreatedArchive {
  name: string;
  uri: string;
  shareable: boolean;
  included: number;
  skipped: number;
  bytes: number;
  /** false: written without encryption */
  encrypted: boolean;
}

/** `songIds`: only these saved songs go into the file (not given: all of them) */
export async function createSongArchive(opts: { secretKey: string | null; withLibrary: boolean; songIds?: string[] }): Promise<CreatedArchive> {
  // without a key (no encryption) there is nothing to calculate: the work is only writing
  start(opts.secretKey === null ? 'writing' : 'key');
  let output: ArchiveOutput | undefined;
  try {
    const db = await openDb();
    const ops = await offlineOps();
    const chosen = opts.songIds ? new Set(opts.songIds) : null;
    const songs = (await listExportSongs(db)).filter((x) => !chosen || chosen.has(x.song.id));
    let approx = 0;
    for (const x of songs) approx += (await ops.fileSize(x.fileName)) ?? 0;
    const free = await freeDiskBytes();
    if (free < spaceNeeded(approx)) throw new Error(`空き容量が足りません（必要: ${formatBytes(spaceNeeded(approx))}、空き: ${formatBytes(free)}）`);
    const library = opts.withLibrary ? await libraryAsJson(db) : undefined;
    const name = songArchiveFileName(new Date());
    output = await createArchiveOutput(name);
    const result = await exportSongArchive({
      songs,
      fileSize: ops.fileSize,
      openFile: ops.openFile,
      library,
      sink: output.sink,
      secretKey: opts.secretKey,
      appVersion: APP_VERSION,
      onKeyProgress: (f) => useSongArchive.setState({ phase: 'key', keyProgress: f }),
      onProgress: (p) => useSongArchive.setState({ phase: 'writing', done: p.done, total: p.total, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, title: p.title ?? '' }),
      isCancelled,
    });
    output.close();
    return { name, uri: output.uri, shareable: output.shareable, included: result.included, skipped: result.skipped.length, bytes: result.bytes, encrypted: opts.secretKey !== null };
  } catch (e) {
    await output?.abort().catch(() => undefined); // a half file would look like a backup
    throw e;
  } finally {
    finish();
  }
}

export interface AudioExportSummary {
  written: number;
  skipped: number;
  bytes: number;
  /** stopped by the person: the files that were finished stay */
  cancelled: boolean;
}

/**
 * The chosen saved songs as plain audio files, one per song (no conversion – the bytes are copied as they are). Uses the same
 * progress and cancel as the file job: only one of them runs at a time.
 */
export async function exportSavedAsAudio(opts: { songIds: string[] }): Promise<AudioExportSummary> {
  start('writing');
  try {
    const db = await openDb();
    const ops = await offlineOps();
    const chosen = new Set(opts.songIds);
    const songs = (await listExportSongs(db)).filter((x) => chosen.has(x.song.id));
    let approx = 0;
    for (const x of songs) approx += (await ops.fileSize(x.fileName)) ?? 0;
    const free = await freeDiskBytes();
    if (free < spaceNeeded(approx)) throw new Error(`空き容量が足りません（必要: ${formatBytes(spaceNeeded(approx))}、空き: ${formatBytes(free)}）`);
    const r = await exportAudioFiles({
      songs,
      fileSize: ops.fileSize,
      openFile: ops.openFile,
      begin: createAudioOutput,
      onProgress: (p) => useSongArchive.setState({ phase: 'writing', done: p.done, total: p.total, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, title: p.title }),
      isCancelled,
    });
    return { written: r.written.length, skipped: r.skipped.length, bytes: r.bytes, cancelled: r.cancelled };
  } finally {
    finish();
  }
}

export interface OpenedArchive {
  reader: ArchiveReader;
  manifest: Manifest;
  /** songs of the archive that are already saved here */
  alreadyIds: Set<string>;
  /** the bytes of the songs that would be restored */
  newBytes: number;
  freeBytes: number;
  /** was the file protected by a key (false: written without encryption) */
  encrypted: boolean;
  close: () => void;
}

/** Does the file need the secret key? Only its first 30 bytes are read. */
export async function peekSongArchiveFile(entry: BackupEntry): Promise<{ encrypted: boolean }> {
  const input = openArchiveInput(entry.uri);
  try {
    return await peekArchive(input.source);
  } finally {
    input.close();
  }
}

/** a saved song: its row AND its file */
async function songIsHere(id: string): Promise<boolean> {
  const db = await openDb();
  const row = await repo.offlineFile(db, id);
  if (!row) return false;
  return (await (await offlineOps()).fileSize(row.fileName)) !== null;
}

/** opens the archive with the secret key (the wrong key is found out here) and says what is in it; nothing is changed yet */
export async function openSongArchiveFile(entry: BackupEntry, secretKey: string): Promise<OpenedArchive> {
  start('key'); // (a file without encryption finishes this step at once)
  const input = openArchiveInput(entry.uri);
  try {
    const { reader, manifest } = await openSongArchive(input.source, secretKey, { onKeyProgress: (f) => useSongArchive.setState({ phase: 'key', keyProgress: f }), isCancelled });
    const alreadyIds = new Set<string>();
    let newBytes = 0;
    for (const song of manifest.songs) {
      if (await songIsHere(song.id)) alreadyIds.add(song.id);
      else newBytes += song.size;
    }
    return { reader, manifest, alreadyIds, newBytes, freeBytes: await freeDiskBytes(), encrypted: reader.encrypted, close: input.close };
  } catch (e) {
    input.close();
    throw e;
  } finally {
    finish();
  }
}

export async function restoreOpenedArchive(opened: OpenedArchive): Promise<RestoreResult> {
  start('reading');
  try {
    const db = await openDb();
    const ops = await offlineOps();
    return await restoreSongArchive({
      reader: opened.reader,
      manifest: opened.manifest,
      hasSong: songIsHere,
      beginFile: ops.beginFile,
      saveSong: (meta, file) => saveRestoredSong(db, meta, file),
      importLibrary: (text) => applyLibraryJson(db, text),
      onProgress: (p) => useSongArchive.setState({ phase: 'reading', done: p.done, total: p.total, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, title: p.title ?? '' }),
      isCancelled,
    });
  } finally {
    opened.close();
    finish();
    await useOffline.getState().load(); // the songs that came back are marked as saved everywhere
    useOffline.setState((st) => ({ version: st.version + 1 }));
    useLikes.setState((st) => ({ version: st.version + 1 }));
  }
}

export { hasOfflineRow };
