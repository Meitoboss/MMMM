import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { isBackupFileName } from '../core/backup';
import { nameFromContentUri } from '../core/localMeta';
import { chooseAndroidFolder, savedAndroidFolder } from './localFiles';

/**
 * Where backups live.
 *  iPhone:  the app's Documents/Backups – the Files app shows it (On My iPhone → Music space → Backups), so a backup can be
 *           moved to iCloud Drive, AirDropped, or put back from there.
 *  Android: the folder that was chosen for local music (asked for once) – a normal folder you can see.
 */
export interface BackupEntry {
  name: string;
  uri: string;
}

const isAndroid = Platform.OS === 'android';
const iosDir = (): string => `${FileSystem.documentDirectory}Backups/`;

export function whereBackups(): string {
  return isAndroid ? (savedAndroidFolder() ? '選んだフォルダの中' : '保存先のフォルダを、最初に選びます') : '「ファイル」アプリ →「このiPhone内」→ Music space →「Backups」';
}

/** Android: a folder has to be chosen once; returns false when the person did not choose one */
export async function ensureBackupFolder(): Promise<boolean> {
  if (!isAndroid || savedAndroidFolder()) return true;
  return chooseAndroidFolder();
}

export async function saveBackupFile(name: string, text: string): Promise<{ uri: string; shareable: boolean }> {
  if (!isAndroid) {
    await FileSystem.makeDirectoryAsync(iosDir(), { intermediates: true }).catch(() => undefined);
    const uri = `${iosDir()}${name}`;
    await FileSystem.writeAsStringAsync(uri, text);
    return { uri, shareable: true };
  }
  if (!(await ensureBackupFolder())) throw new Error('保存先のフォルダが選ばれませんでした');
  const folder = savedAndroidFolder();
  if (!folder) throw new Error('保存先のフォルダが選ばれませんでした');
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(folder, name.replace(/\.json$/i, ''), 'application/json');
  await FileSystem.writeAsStringAsync(uri, text);
  return { uri, shareable: false };
}

/** the backups found, newest first (the names carry the date) */
export async function listBackupFiles(): Promise<BackupEntry[]> {
  let entries: BackupEntry[] = [];
  if (isAndroid) {
    const folder = savedAndroidFolder();
    if (!folder) return [];
    const uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(folder);
    entries = uris.map((uri) => ({ uri, name: nameFromContentUri(uri) }));
  } else {
    await FileSystem.makeDirectoryAsync(iosDir(), { intermediates: true }).catch(() => undefined);
    entries = (await FileSystem.readDirectoryAsync(iosDir())).map((name) => ({ uri: `${iosDir()}${name}`, name }));
  }
  return entries.filter((e) => isBackupFileName(e.name)).sort((a, b) => b.name.localeCompare(a.name));
}

export const readBackupFile = (uri: string): Promise<string> => FileSystem.readAsStringAsync(uri);
