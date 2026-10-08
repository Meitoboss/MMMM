import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { generateSecretKey as genSecretKey } from '../state/settings';

export { genSecretKey as generateSecretKey };

export async function exportLikedSongs(secretKey: string): Promise<void> {
  try {
    const db = await openDb();
    const liked = await repo.likedSongs(db);

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
    Alert.alert('エラー', error instanceof Error ? error.message : 'エクスポートに失敗しました');
  }
}
