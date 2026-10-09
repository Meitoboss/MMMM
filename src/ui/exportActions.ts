import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { generateSecretKey as genSecretKey } from '../state/settings';
import { useOffline } from '../state/offline';
import { offlineDir } from '../player/offline';

export { genSecretKey as generateSecretKey };

export async function exportLikedSongs(secretKey: string): Promise<void> {
  try {
    console.log('exportLikedSongs started');
    const db = await openDb();
    console.log('database opened');

    const offlineIds = useOffline.getState().ids;
    const offlineSongIds = Object.keys(offlineIds);
    console.log('offline songs count:', offlineSongIds.length);

    if (!offlineSongIds.length) {
      Alert.alert('エクスポート', 'オフライン保存した曲がありません');
      return;
    }

    const songs = await Promise.all(offlineSongIds.map((id) => repo.getSong(db, id)));
    const validSongs = songs.filter((s) => s !== null) as any[];

    if (!validSongs.length) {
      Alert.alert('エクスポート', 'オフライン保存した曲の情報が見つかりません');
      return;
    }

    const exportData = {
      version: 1,
      exportDate: new Date().toISOString(),
      key: secretKey,
      count: validSongs.length,
      songs: validSongs.map((song) => ({
        id: song.id,
        title: song.title,
        artists: song.artists.map((a) => a.name),
        album: song.album?.name,
        thumbnail: song.thumbnail,
      })),
    };

    const fileName = `musicspace-liked-${new Date().toISOString().split('T')[0]}.json`;
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(exportData, null, 2));

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: '保存した曲をエクスポート' });
    } else {
      Alert.alert('エクスポート', `ファイルを作成しました: ${fileName}`);
    }
  } catch (error) {
    console.error('exportLikedSongs error:', error);
    console.error('error stack:', error instanceof Error ? error.stack : 'no stack');
    const message = error instanceof Error ? error.message : String(error);
    Alert.alert('エラー', message || 'エクスポートに失敗しました');
  }
}

export async function exportOfflineMp3(secretKey: string, inputKey: string): Promise<void> {
  try {
    console.log('Step 1: exportOfflineMp3 started');
    if (secretKey !== inputKey) {
      Alert.alert('エクスポート', 'キーが合いません');
      return;
    }

    console.log('Step 2: Getting offline state');
    const offlineState = useOffline.getState();
    const offlineIds = offlineState.ids;
    const offlineSongIds = Object.keys(offlineIds);
    console.log('Step 3: Found', offlineSongIds.length, 'offline songs');

    if (!offlineSongIds.length) {
      Alert.alert('エクスポート', 'オフライン保存した曲がありません');
      return;
    }

    console.log('Step 4: Opening database');
    const db = await openDb();
    console.log('Step 5: Getting song data for', offlineSongIds.length, 'songs');
    const songs = await Promise.all(offlineSongIds.map((id) => repo.getSong(db, id)));
    const validSongs = songs.filter((s) => s !== null) as any[];
    console.log('Step 6: Got', validSongs.length, 'valid songs');

    if (!validSongs.length) {
      Alert.alert('エクスポート', 'オフライン保存した曲の情報が見つかりません');
      return;
    }

    console.log('Step 7: Creating temp directory');
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) throw new Error('cacheDirectory is not available');
    const tempDir = `${cacheDir}musicspace-export-${Date.now()}/`;
    console.log('Step 8: tempDir =', tempDir);
    await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
    console.log('Step 9: Temp directory created');

    console.log('Step 10: Getting offline directory');
    const offline = offlineDir();
    console.log('Step 11: offline directory =', offline);

    // Check if offline directory exists
    const offlineDirInfo = await FileSystem.getInfoAsync(offline);
    console.log('Step 11b: offline directory exists?', offlineDirInfo.exists, '(isDirectory:', offlineDirInfo.isDirectory, ')');

    let copiedCount = 0;
    let failedCount = 0;
    const fileResults: string[] = [];

    for (const song of validSongs) {
      try {
        const fileName = await repo.getOfflineFileName(db, song.id);
        if (!fileName) {
          console.warn(`No filename for song: ${song.title}`);
          fileResults.push(`NO_FILENAME: ${song.title}`);
          failedCount++;
          continue;
        }

        const srcFile = `${offline}${fileName}`;
        console.log(`Checking file: ${srcFile}`);

        // Check if source file exists
        const fileInfo = await FileSystem.getInfoAsync(srcFile);
        console.log(`  exists: ${fileInfo.exists}, size: ${fileInfo.size}, isDirectory: ${fileInfo.isDirectory}`);
        if (fileInfo.exists) {
          fileResults.push(`OK: ${fileName} (${fileInfo.size} bytes)`);
        } else {
          fileResults.push(`NOT_FOUND: ${fileName}`);
        }
        if (!fileInfo.exists) {
          console.warn(`Source file not found: ${srcFile}`);
          failedCount++;
          continue;
        }

        const safeName = `${song.title.replace(/[/\\:*?"<>|]/g, '_')} - ${song.artists[0]?.name || 'Unknown'}`;
        const ext = fileName.split('.').pop() || 'm4a';
        const dstFile = `${tempDir}${safeName}.${ext}`;

        await FileSystem.copyAsync({ from: srcFile, to: dstFile });
        console.log(`✓ Copied: ${safeName}.${ext}`);
        copiedCount++;
      } catch (e) {
        console.warn(`File copy failed for song:`, song.title, e);
        failedCount++;
      }
    }

    console.log(`Step 12: Copied ${copiedCount} files, failed ${failedCount}`);

    if (copiedCount === 0) {
      await FileSystem.deleteAsync(tempDir).catch(() => undefined);
      const debugMsg = `ファイルのコピーに失敗しました。

📁 オフラインディレクトリ: ${offline}
   存在: ${offlineDirInfo.exists}, フォルダ: ${offlineDirInfo.isDirectory}

曲のファイル確認:
${fileResults.map((r, i) => `${i + 1}. ${r}`).join('\n')}

- 曲の合計数: ${validSongs.length}
- コピー成功: ${copiedCount}
- コピー失敗: ${failedCount}`;
      Alert.alert('エクスポート失敗', debugMsg);
      return;
    }

    console.log('Step 13: Checking Sharing availability');
    if (await Sharing.isAvailableAsync()) {
      console.log('Step 14: Sharing available, opening share dialog');
      await Sharing.shareAsync(tempDir, {
        dialogTitle: `${copiedCount} 曲をエクスポート`,
      });
      console.log('Step 15: Share dialog closed');
    } else {
      Alert.alert('エクスポート完了', `${copiedCount} 曲をディレクトリに出力しました:\n${tempDir}`);
    }

    setTimeout(() => {
      FileSystem.deleteAsync(tempDir).catch(() => undefined);
    }, 2000);
  } catch (error) {
    console.error('exportOfflineMp3 error:', error);
    if (error instanceof Error) {
      console.error('error stack:', error.stack);
    }
    let message = 'エクスポートに失敗しました';
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    } else {
      message = String(error);
    }
    Alert.alert('エラー', message || 'エクスポートに失敗しました');
  }
}
