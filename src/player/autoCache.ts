import * as FileSystem from 'expo-file-system/legacy';
import Storage from 'expo-sqlite/kv-store';

import { type CacheEntry, pickEvictions } from '../core/autoCacheLru';
import type { AudioSource } from '../core/types';
import { downloadFile, ensureOfflineDir, offlineDir } from './offline';

/**
 * The songs that played for a while are kept on the phone by themselves, so the next time they start at once.
 * They sit beside the saved copies (the file names start with "auto-"), and the oldest go when the limits are reached.
 */
const KEY = 'autocache.index.v1';
export const AUTO_MAX_BYTES = 300 * 1024 * 1024;
export const AUTO_MAX_ITEMS = 30;

function read(): CacheEntry[] {
  try {
    return JSON.parse(Storage.getItemSync(KEY) ?? '[]') as CacheEntry[];
  } catch {
    return [];
  }
}

function write(entries: CacheEntry[]): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(entries));
  } catch {
    /* best effort */
  }
}

/** the kept copy of a song as something the player can play, or null */
export async function cachedAudio(songId: string): Promise<AudioSource | null> {
  const entries = read();
  const hit = entries.find((e) => e.id === songId);
  if (!hit) return null;
  const uri = `${offlineDir()}${hit.file}`;
  const info = await FileSystem.getInfoAsync(uri).catch(() => ({ exists: false }));
  if (!info.exists) {
    write(entries.filter((e) => e.id !== songId));
    return null;
  }
  write(entries.map((e) => (e.id === songId ? { ...e, at: Date.now() } : e)));
  return { url: uri, mimeType: hit.file.endsWith('.m4a') ? 'audio/mp4' : undefined, via: 'local', note: 'auto cache' };
}

/** keeps a song on the phone (only MP4 audio, which the player reads from a file on both systems) */
export async function cacheAudio(songId: string, src: AudioSource): Promise<void> {
  if (!src.mimeType?.includes('mp4')) return;
  const entries = read();
  if (entries.some((e) => e.id === songId)) return;
  await ensureOfflineDir();
  const file = `auto-${songId}.m4a`;
  const bytes = await downloadFile(src, file, () => undefined, () => false);
  const next = [...entries, { id: songId, file, bytes, at: Date.now() }];
  const drop = pickEvictions(next, AUTO_MAX_BYTES, AUTO_MAX_ITEMS);
  for (const d of drop) await FileSystem.deleteAsync(`${offlineDir()}${d.file}`, { idempotent: true }).catch(() => undefined);
  write(next.filter((e) => !drop.some((d) => d.id === e.id)));
}
