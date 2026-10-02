import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { runDownload, type DownloadDeps, type DownloadResult } from '../core/offlineJobs';
import { resolveAudio } from '../core/streams/resolver';
import type { AudioSource, SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { resolverOptions } from '../state/settings';

/**
 * Offline copies of YouTube songs. They live in a folder that only this app can see:
 *   iOS      Library/Application Support/offline/   (NOT Documents – that one is shown in the Files app)
 *   Android  <app files>/offline/                   (private to the app)
 * Only the file NAME is stored in the database; the container path changes when the app is reinstalled or re-signed.
 */
export function offlineDir(): string {
  const doc = FileSystem.documentDirectory ?? '';
  if (Platform.OS === 'ios' && doc.includes('/Documents/')) {
    return `${doc.replace('/Documents/', '/Library/Application%20Support/')}offline/`;
  }
  return `${doc}offline/`;
}

export async function ensureOfflineDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(offlineDir(), { intermediates: true }).catch(() => undefined);
}

const MIN_BYTES = 20_000; // anything smaller is an error page, not a song

async function downloadFile(
  src: AudioSource,
  fileName: string,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<number> {
  await ensureOfflineDir();
  const tmp = `${offlineDir()}${fileName}.part`;
  const final = `${offlineDir()}${fileName}`;
  await FileSystem.deleteAsync(tmp, { idempotent: true });

  // "bytes=0-" asks for the whole file as one ranged request – the way YouTube's servers accept it
  const headers: Record<string, string> = { Range: 'bytes=0-' };
  if (src.userAgent) headers['User-Agent'] = src.userAgent;

  const dl = FileSystem.createDownloadResumable(src.url, tmp, { headers }, (p) => {
    if (isCancelled()) {
      void dl.pauseAsync().catch(() => undefined);
      return;
    }
    if (p.totalBytesExpectedToWrite > 0) onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });

  let res: Awaited<ReturnType<typeof dl.downloadAsync>>;
  try {
    res = await dl.downloadAsync();
  } catch (e) {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
    throw e;
  }
  if (!res || (res.status !== 200 && res.status !== 206)) {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
    if (isCancelled()) throw new Error('cancelled');
    throw new Error(res ? `保存できませんでした（HTTP ${res.status}）` : 'ダウンロードが中断されました');
  }
  const info = await FileSystem.getInfoAsync(tmp);
  const size = info.exists && 'size' in info ? info.size : 0;
  if (size < MIN_BYTES) {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
    throw new Error('ダウンロードしたデータが小さすぎます');
  }
  await FileSystem.deleteAsync(final, { idempotent: true });
  await FileSystem.moveAsync({ from: tmp, to: final });
  return size;
}

export const offlineDeps: DownloadDeps = {
  resolve: (videoId) => resolveAudio(videoId, resolverOptions()),
  download: downloadFile,
  remove: (fileName) => FileSystem.deleteAsync(`${offlineDir()}${fileName}`, { idempotent: true }),
};

export function saveOfflineNow(song: SongItem, onProgress?: (f: number) => void, isCancelled?: () => boolean): Promise<DownloadResult> {
  return openDb().then((db) => runDownload(db, offlineDeps, song, onProgress, isCancelled));
}

/** The saved copy of a song as something the player can play – or null (then the song is streamed as usual). */
export async function resolveOffline(songId: string): Promise<AudioSource | null> {
  try {
    const db = await openDb();
    const row = await repo.offlineFile(db, songId);
    if (!row) return null;
    const uri = `${offlineDir()}${row.fileName}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      await repo.deleteOffline(db, songId); // the file is gone (the OS cleaned it up): forget it
      return null;
    }
    return { url: uri, mimeType: row.mimeType ?? undefined, via: 'offline', note: 'saved copy' };
  } catch {
    return null;
  }
}

export async function removeOfflineCopy(songId: string): Promise<void> {
  const name = await repo.deleteOffline(await openDb(), songId);
  if (name) await offlineDeps.remove(name);
}

export async function removeAllOfflineCopies(): Promise<number> {
  const db = await openDb();
  const names = await repo.allOfflineFileNames(db);
  for (const n of names) {
    await offlineDeps.remove(n).catch(() => undefined);
    await db.run('DELETE FROM Offline WHERE fileName = ?', [n]);
  }
  return names.length;
}
