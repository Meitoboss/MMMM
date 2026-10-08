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
    const liked = await repo.likedSongs(db);
    console.log('liked songs fetched:', liked.length);

    if (!liked.length) {
      Alert.alert('エクスポート', '保存した曲がありません');
      return;
    }

    const exportData = {
      version: 1,
      exportDate: new Date().toISOString(),
      key: secretKey,
      count: liked.length,
      songs: liked.map((song) => ({
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
    console.log('1. exportOfflineMp3 started');
    if (secretKey !== inputKey) {
      Alert.alert('エクスポート', 'キーが合いません');
      return;
    }

    console.log('2. Getting offline state');
    const offlineState = useOffline.getState();
    console.log('3. offlineState:', offlineState);
    const offlineIds = offlineState.ids;
    console.log('4. offlineIds:', offlineIds);
    const offlineSongIds = Object.keys(offlineIds);

    if (!offlineSongIds.length) {
      Alert.alert('エクスポート', 'オフライン保存した曲がありません');
      return;
    }

    const db = await openDb();
    const songs = await Promise.all(offlineSongIds.map((id) => repo.getSong(db, id)));
    const validSongs = songs.filter((s) => s !== null) as any[];

    if (!validSongs.length) {
      Alert.alert('エクスポート', 'オフライン保存した曲の情報が見つかりません');
      return;
    }

    const tempDir = `${FileSystem.cacheDirectory}musicspace-export-${Date.now()}/`;
    await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

    const offline = offlineDir();
    let copiedCount = 0;
    const exportedFiles: string[] = [];

    for (const song of validSongs) {
      const fileName = await repo.getOfflineFileName(db, song.id);
      if (!fileName) continue;

      const srcFile = `${offline}${fileName}`;
      const safeName = `${song.title.replace(/[/\\:*?"<>|]/g, '_')} - ${song.artists[0]?.name || 'Unknown'}`;
      const ext = fileName.split('.').pop() || 'm4a';
      const dstFile = `${tempDir}${safeName}.${ext}`;

      try {
        await FileSystem.copyAsync({ from: srcFile, to: dstFile });
        exportedFiles.push(dstFile);
        copiedCount++;
      } catch (e) {
        console.warn(`ファイルコピー失敗: ${song.title}`, e);
      }
    }

    if (copiedCount === 0) {
      await FileSystem.deleteAsync(tempDir);
      Alert.alert('エクスポート', 'ファイルのコピーに失敗しました');
      return;
    }

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(tempDir, {
        dialogTitle: `${copiedCount} 曲をエクスポート`,
      });
    } else {
      Alert.alert('エクスポート', `${copiedCount} 曲をディレクトリに出力しました: ${tempDir}`);
    }

    setTimeout(() => {
      FileSystem.deleteAsync(tempDir).catch(() => undefined);
    }, 2000);
  } catch (error) {
    console.error('exportOfflineMp3 error:', error);
    console.error('error stack:', error instanceof Error ? error.stack : 'no stack');
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
