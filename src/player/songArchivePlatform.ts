import { File } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import type { AudioOutput } from '../core/audioExport';
import { isSongArchiveName } from '../core/songArchive';
import { type FileHandleLike, type FsLike, offlineFileOps, sinkToFile, sourceFromFile } from './archiveIo';
import { type BackupEntry, ensureBackupFolder, listFolderFiles } from './backupFiles';
import { savedAndroidFolder } from './localFiles';
import { ensureOfflineDir, offlineDir } from './offline';

/** the real files of the phone (Expo's File and FileHandle for the bytes; the older calls for move / delete / size) */
export const expoFs: FsLike = {
  file(uri) {
    const f = new File(uri);
    return {
      get exists() {
        return f.exists;
      },
      create: () => f.create(),
      delete: () => f.delete(),
      open: () => f.open() as unknown as FileHandleLike,
    };
  },
  async move(from, to) {
    await Legacy.deleteAsync(to, { idempotent: true });
    await Legacy.moveAsync({ from, to });
  },
  remove: (uri) => Legacy.deleteAsync(uri, { idempotent: true }),
  async sizeOf(uri) {
    const info = await Legacy.getInfoAsync(uri);
    return info.exists && 'size' in info ? info.size : null;
  },
};

/** read / write the saved songs' folder */
export async function offlineOps() {
  await ensureOfflineDir();
  return offlineFileOps(expoFs, offlineDir());
}

export const freeDiskBytes = (): Promise<number> => Legacy.getFreeDiskStorageAsync();

const isAndroid = Platform.OS === 'android';
const iosDir = (): string => `${Legacy.documentDirectory}Backups/`;

export function whereArchives(): string {
  return isAndroid ? (savedAndroidFolder() ? '選んだフォルダの中' : '保存先のフォルダを、最初に選びます') : '「ファイル」アプリ →「このiPhone内」→ Music space →「Backups」';
}

export interface ArchiveOutput {
  uri: string;
  sink: { write(bytes: Uint8Array): void };
  close(): void;
  abort(): Promise<void>;
  /** the system's share sheet can take this file (iPhone) */
  shareable: boolean;
}

/** a new file for the archive: on the iPhone in Documents/Backups (shown by the Files app), on Android in the chosen folder */
export async function createArchiveOutput(name: string): Promise<ArchiveOutput> {
  if (!isAndroid) {
    await Legacy.makeDirectoryAsync(iosDir(), { intermediates: true }).catch(() => undefined);
    const uri = `${iosDir()}${name}`;
    return { uri, ...sinkToFile(expoFs, uri), shareable: true };
  }
  if (!(await ensureBackupFolder())) throw new Error('保存先のフォルダが選ばれませんでした');
  const folder = savedAndroidFolder();
  if (!folder) throw new Error('保存先のフォルダが選ばれませんでした');
  const uri = await Legacy.StorageAccessFramework.createFileAsync(folder, name, 'application/octet-stream');
  return { uri, ...sinkToFile(expoFs, uri), shareable: false };
}

/** where the audio files of single songs go: on the iPhone Documents/Export (not Documents/Music: that folder is where songs are put to be imported) */
const iosAudioDir = (): string => `${Legacy.documentDirectory}Export/`;

export function whereAudio(): string {
  return isAndroid ? (savedAndroidFolder() ? '選んだフォルダの中' : '保存先のフォルダを、最初に選びます') : '「ファイル」アプリ →「このiPhone内」→ Music space →「Export」';
}

/**
 * A new audio file. iPhone: written under a temporary name and renamed when it is complete (a half file never looks like a song).
 * Android: in the chosen folder; the name goes without its extension – Android adds the one that belongs to the type.
 */
export async function createAudioOutput(name: string, mime: string): Promise<AudioOutput> {
  if (!isAndroid) {
    await Legacy.makeDirectoryAsync(iosAudioDir(), { intermediates: true }).catch(() => undefined);
    const final = `${iosAudioDir()}${name}`;
    const part = `${final}.part`;
    const out = sinkToFile(expoFs, part);
    return {
      sink: out.sink,
      async commit() {
        out.close();
        await expoFs.move(part, final);
      },
      abort: () => out.abort(),
    };
  }
  if (!(await ensureBackupFolder())) throw new Error('保存先のフォルダが選ばれませんでした');
  const folder = savedAndroidFolder();
  if (!folder) throw new Error('保存先のフォルダが選ばれませんでした');
  const uri = await Legacy.StorageAccessFramework.createFileAsync(folder, name.replace(/\.[A-Za-z0-9]{1,5}$/, ''), mime);
  const out = sinkToFile(expoFs, uri);
  return { sink: out.sink, commit: async () => out.close(), abort: () => out.abort() };
}

export const openArchiveInput = (uri: string) => sourceFromFile(expoFs, uri);

export const listSongArchives = (): Promise<BackupEntry[]> => listFolderFiles(isSongArchiveName);

