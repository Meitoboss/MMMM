import { create } from 'zustand';

import { APP_VERSION } from '../appVersion';
import { ArchiveError, type ArchiveReader } from '../core/archive';
import { type Manifest, type RestoreResult, exportSongArchive, formatBytes, openSongArchive, restoreSongArchive, songArchiveFileName, spaceNeeded } from '../core/songArchive';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { applyLibraryJson, hasOfflineRow, libraryAsJson, listExportSongs, saveRestoredSong } from '../db/songArchive';
import { type ArchiveOutput, createArchiveOutput, freeDiskBytes, offlineOps, openArchiveInput } from '../player/songArchivePlatform';
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

export interface CreatedArchive {
  name: string;
  uri: string;
  shareable: boolean;
  included: number;
  skipped: number;
  bytes: number;
}

export async function createSongArchive(opts: { secretKey: string; withLibrary: boolean }): Promise<CreatedArchive> {
  start('key');
  let output: ArchiveOutput | undefined;
  try {
    const db = await openDb();
    const ops = await offlineOps();
    const songs = await listExportSongs(db);
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
    return { name, uri: output.uri, shareable: output.shareable, included: result.included, skipped: result.skipped.length, bytes: result.bytes };
  } catch (e) {
    await output?.abort().catch(() => undefined); // a half file would look like a backup
    throw e;
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
  close: () => void;
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
  start('key');
  const input = openArchiveInput(entry.uri);
  try {
    const { reader, manifest } = await openSongArchive(input.source, secretKey, { onKeyProgress: (f) => useSongArchive.setState({ phase: 'key', keyProgress: f }), isCancelled });
    const alreadyIds = new Set<string>();
    let newBytes = 0;
    for (const song of manifest.songs) {
      if (await songIsHere(song.id)) alreadyIds.add(song.id);
      else newBytes += song.size;
    }
    return { reader, manifest, alreadyIds, newBytes, freeBytes: await freeDiskBytes(), close: input.close };
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
