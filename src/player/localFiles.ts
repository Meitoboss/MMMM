import * as FileSystem from 'expo-file-system/legacy';

import { runImport, type ImportDeps, type ImportResult, type InboxFile } from '../core/localImport';
import { isAudioFileName } from '../core/localMeta';
import type { AudioSource } from '../core/types';
import type { Db } from '../db/driver';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

export type { ImportResult, InboxFile };

/**
 * Music on this device.
 *
 *   inbox   Documents/Music/   – shown in the Files app (On My iPhone → Music space → Music). The user drops files here.
 *   store   Documents/local/   – where imported files live; only the file NAME is stored in the database, because the
 *                                absolute path of the app container changes when the app is reinstalled or re-signed.
 *
 * No native file-picker module is needed: the Files app does the picking.
 */
const root = () => FileSystem.documentDirectory ?? '';
const inboxDir = () => `${root()}Music/`;
const storeDir = () => `${root()}local/`;
export const localUri = (fileName: string): string => `${storeDir()}${fileName}`;

/** Creates the folders (so "Music" shows up in the Files app). Safe to call every launch. */
export async function ensureFolders(): Promise<void> {
  await FileSystem.makeDirectoryAsync(inboxDir(), { intermediates: true }).catch(() => undefined);
  await FileSystem.makeDirectoryAsync(storeDir(), { intermediates: true }).catch(() => undefined);
}

async function readNames(dir: string): Promise<string[]> {
  try {
    return await FileSystem.readDirectoryAsync(dir);
  } catch {
    return [];
  }
}

/** music files waiting in the folder "Music" (and loose ones in the app's top folder) */
export async function listInbox(): Promise<InboxFile[]> {
  const out: InboxFile[] = [];
  for (const dir of [inboxDir(), root()]) {
    for (const name of await readNames(dir)) {
      if (isAudioFileName(name)) out.push({ name, uri: `${dir}${encodeURIComponent(name)}` });
    }
  }
  return out;
}

const deps: ImportDeps = {
  list: listInbox,
  move: async (from, stored) => {
    await ensureFolders();
    await FileSystem.moveAsync({ from, to: localUri(stored) });
  },
  undo: async (stored, original) => {
    await FileSystem.moveAsync({ from: localUri(stored), to: original });
  },
  size: async (uri) => {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? info.size : undefined;
  },
};

export async function importLocalFiles(db?: Db): Promise<ImportResult> {
  return runImport(db ?? (await openDb()), deps);
}

/** Delete the song from the library (playlists, history, likes) and the copy on the device. */
export async function removeLocalFile(songId: string, db?: Db): Promise<void> {
  const name = await repo.deleteLocalFile(db ?? (await openDb()), songId);
  if (name) await FileSystem.deleteAsync(localUri(name), { idempotent: true });
}

/** What the player needs to play a local song. */
export async function resolveLocal(songId: string): Promise<AudioSource> {
  const name = await repo.localFileName(await openDb(), songId);
  if (!name) throw new Error('この曲はライブラリから削除されています');
  const uri = localUri(name);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('ファイルが見つかりません（端末から削除された可能性があります）');
  return { url: uri, via: 'local', note: 'local file' };
}
