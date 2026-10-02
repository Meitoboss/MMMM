import Storage from 'expo-sqlite/kv-store';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { runImport, type ImportDeps, type ImportResult, type InboxFile } from '../core/localImport';
import { isAudioFileName, nameFromContentUri } from '../core/localMeta';
import type { AudioSource } from '../core/types';
import type { Db } from '../db/driver';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

export type { ImportResult, InboxFile };

/**
 * Music on this device. The app keeps its own copy of every imported song:
 *
 *   store   <app documents>/local/   – only the file NAME is stored in the database, because the absolute path of the app
 *                                      container changes when the app is reinstalled or re-signed.
 *
 * Where the music comes from depends on the platform (neither needs a native file-picker module):
 *
 *   iOS      the user drops files into  Files app → On My iPhone → Music space → Music  (Documents/Music/).
 *            "Import" MOVES them into the store.
 *   Android  the user picks a folder once (the system folder picker, Storage Access Framework); "Import" COPIES the music
 *            files in it into the store and remembers which ones it has already taken.
 */
export const isAndroid = Platform.OS === 'android';

const root = () => FileSystem.documentDirectory ?? '';
const inboxDir = () => `${root()}Music/`;
const storeDir = () => `${root()}local/`;
export const localUri = (fileName: string): string => `${storeDir()}${fileName}`;

/** Creates the folders (on iOS "Music" then shows up in the Files app). Safe to call every launch. */
export async function ensureFolders(): Promise<void> {
  if (!isAndroid) await FileSystem.makeDirectoryAsync(inboxDir(), { intermediates: true }).catch(() => undefined);
  await FileSystem.makeDirectoryAsync(storeDir(), { intermediates: true }).catch(() => undefined);
}

/* ------------------------------ Android: the picked folder ------------------------------ */

const FOLDER_KEY = 'local.androidFolder.v1';

export function savedAndroidFolder(): string | null {
  try {
    return Storage.getItemSync(FOLDER_KEY);
  } catch {
    return null;
  }
}

/** Opens the system folder picker. Returns false when the user cancels. */
export async function chooseAndroidFolder(): Promise<boolean> {
  const saf = FileSystem.StorageAccessFramework;
  const res = await saf.requestDirectoryPermissionsAsync();
  if (!res.granted) return false;
  try {
    Storage.setItemSync(FOLDER_KEY, res.directoryUri);
  } catch {
    /* works until the app closes */
  }
  return true;
}

/* ------------------------------ listing / importing ------------------------------ */

async function readNames(dir: string): Promise<string[]> {
  try {
    return await FileSystem.readDirectoryAsync(dir);
  } catch {
    return [];
  }
}

async function listIosInbox(): Promise<InboxFile[]> {
  const out: InboxFile[] = [];
  for (const dir of [inboxDir(), root()]) {
    for (const name of await readNames(dir)) {
      if (isAudioFileName(name)) out.push({ name, uri: `${dir}${encodeURIComponent(name)}` });
    }
  }
  return out;
}

async function listAndroidFolder(): Promise<InboxFile[]> {
  const folder = savedAndroidFolder();
  if (!folder) return [];
  let uris: string[] = [];
  try {
    uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(folder);
  } catch {
    return []; // permission gone (folder deleted / access revoked): the user picks again
  }
  return uris.map((uri) => ({ uri, name: nameFromContentUri(uri) })).filter((f) => isAudioFileName(f.name));
}

/** music files that are ready to be imported */
export async function listInbox(): Promise<InboxFile[]> {
  const all = isAndroid ? await listAndroidFolder() : await listIosInbox();
  if (!isAndroid) return all;
  const db = await openDb();
  const fresh: InboxFile[] = [];
  for (const f of all) if (!(await repo.isSourceImported(db, f.uri))) fresh.push(f);
  return fresh;
}

async function iosDeps(): Promise<ImportDeps> {
  return {
    list: listIosInbox,
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
}

async function androidDeps(db: Db): Promise<ImportDeps> {
  return {
    list: listAndroidFolder,
    move: async (from, stored) => {
      await ensureFolders();
      await FileSystem.copyAsync({ from, to: localUri(stored) });
    },
    undo: async (stored) => {
      await FileSystem.deleteAsync(localUri(stored), { idempotent: true });
    },
    size: async (uri) => {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        return info.exists && 'size' in info ? info.size : undefined;
      } catch {
        return undefined; // some providers cannot report a size
      }
    },
    alreadyImported: (f) => repo.isSourceImported(db, f.uri),
    markImported: (f) => repo.markSourceImported(db, f.uri),
  };
}

export async function importLocalFiles(db?: Db): Promise<ImportResult> {
  const database = db ?? (await openDb());
  if (isAndroid && !savedAndroidFolder()) throw new Error('先に、音楽が入っているフォルダを選んでください。');
  return runImport(database, isAndroid ? await androidDeps(database) : await iosDeps());
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
