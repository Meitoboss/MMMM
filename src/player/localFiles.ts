import * as FileSystem from 'expo-file-system/legacy';

import { LOCAL_PREFIX, fileExtension, makeLocalId, parseLocalName } from '../core/localMeta';
import type { AudioSource, SongItem } from '../core/types';
import type { Db } from '../db/driver';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

/**
 * TEMPORARY (crash investigation): the native file-picker module (expo-document-picker) is left out of this build.
 * To bring it back: add "expo-document-picker" to package.json and restore the call in importLocalFiles().
 */
/**
 * Songs imported from the device. Files are copied into the app's own Documents folder so they keep working
 * after the original is moved, and only the file NAME is stored in the database – the absolute path of the
 * app container changes when the app is reinstalled or re-signed.
 */
const dir = () => `${FileSystem.documentDirectory}local/`;
export const localUri = (fileName: string): string => `${dir()}${fileName}`;

export interface ImportResult {
  added: SongItem[];
  failed: string[];
  cancelled: boolean;
}

export async function importLocalFiles(db?: Db): Promise<ImportResult> {
  const database = db ?? (await openDb());
  throw new Error('このビルドでは、ファイル選択を一時的に外しています（起動できない原因を調べているため）。');
  // eslint-disable-next-line no-unreachable
  const res = { canceled: true, assets: [] as { uri: string; name: string; size?: number | null }[] };
  if (res.canceled) return { added: [], failed: [], cancelled: true };

  await FileSystem.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined);
  const added: SongItem[] = [];
  const failed: string[] = [];
  for (const a of res.assets) {
    try {
      const id = makeLocalId();
      // ASCII-only stored name: Japanese file names would need URL-encoding for the player. The title lives in the database.
      const stored = `${id.slice(LOCAL_PREFIX.length)}${fileExtension(a.name)}`;
      await FileSystem.moveAsync({ from: a.uri, to: localUri(stored) });
      const meta = parseLocalName(a.name);
      added.push(await repo.addLocalFile(database, { id, fileName: stored, title: meta.title, artist: meta.artist, size: a.size ?? undefined }));
    } catch {
      failed.push(a.name);
    }
  }
  return { added, failed, cancelled: false };
}

/** Delete the song from the library (playlists, history, likes) and the copied file from the device. */
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
