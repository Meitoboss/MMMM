import type { Db } from '../db/driver';
import * as repo from '../db/repo';
import { isLocalId } from './localMeta';
import type { AudioSource, SongItem } from './types';

/**
 * Saving a YouTube song inside the app. The phone-specific parts (resolving the stream, writing the file) are injected,
 * so the flow can be tested without a phone.
 */
export interface DownloadDeps {
  resolve(videoId: string): Promise<AudioSource>;
  /** writes the stream to a file called `fileName` in the app's private folder; returns its size in bytes */
  download(src: AudioSource, fileName: string, onProgress: (fraction: number) => void, isCancelled: () => boolean): Promise<number>;
  remove(fileName: string): Promise<void>;
}

export function extensionFor(mime?: string): string {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (m === 'video/mp4') return '.mp4';
  if (m === 'audio/webm') return '.webm';
  if (m === 'audio/ogg') return '.ogg';
  return '.m4a';
}

/** keeps letters, digits, "-" and "_" – YouTube ids already are, anything else would be a path problem */
export function safeFileStem(id: string): string {
  let out = '';
  for (const ch of id) {
    const ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '-' || ch === '_';
    out += ok ? ch : '_';
  }
  return out || 'song';
}

export interface DownloadResult {
  fileName: string;
  size: number;
  mimeType?: string;
  /** true when the song was already saved and nothing was downloaded */
  already: boolean;
}

export async function runDownload(
  db: Db,
  deps: DownloadDeps,
  song: SongItem,
  onProgress: (fraction: number) => void = () => undefined,
  isCancelled: () => boolean = () => false,
): Promise<DownloadResult> {
  if (isLocalId(song.id)) throw new Error('この曲は、すでに端末内にあります');

  const existing = await repo.offlineFile(db, song.id);
  if (existing) return { fileName: existing.fileName, size: existing.size ?? 0, mimeType: existing.mimeType ?? undefined, already: true };

  const src = await deps.resolve(song.id);
  if (isCancelled()) throw new Error('cancelled');
  const fileName = `${safeFileStem(song.id)}${extensionFor(src.mimeType)}`;
  const size = await deps.download(src, fileName, onProgress, isCancelled);
  if (isCancelled()) {
    await deps.remove(fileName).catch(() => undefined);
    throw new Error('cancelled');
  }
  try {
    await repo.addOffline(db, song, { fileName, size, mimeType: src.mimeType });
  } catch (e) {
    await deps.remove(fileName).catch(() => undefined); // never keep a file the database does not know about
    throw e;
  }
  return { fileName, size, mimeType: src.mimeType, already: false };
}
