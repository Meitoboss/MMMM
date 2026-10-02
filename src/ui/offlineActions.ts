import Storage from 'expo-sqlite/kv-store';
import { Alert } from 'react-native';

import { isLocalId } from '../core/localMeta';
import type { SongItem } from '../core/types';
import { useOffline } from '../state/offline';

const ACK_KEY = 'offline.ack.v1';

function acknowledged(): boolean {
  try {
    return Storage.getItemSync(ACK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Shown once, before the first save. */
function askAcknowledge(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'オフライン保存について',
      '保存した曲は、このアプリの中だけで再生できます（「ファイル」アプリには出ず、取り出すこともできません）。\n\nYouTubeの利用規約や、お住まいの国の著作権法に反しない範囲で、ご自身の責任でお使いください。権利者の許可なくアップロードされた曲は、保存しないでください。',
      [
        { text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
        {
          text: '理解して保存',
          onPress: () => {
            try {
              Storage.setItemSync(ACK_KEY, '1');
            } catch {
              /* asked again next time */
            }
            resolve(true);
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function confirmMany(count: number): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert('まとめて保存しますか？', `${count}曲（約${Math.max(1, Math.round(count * 3.5))}MB）を、順番に保存します。`, [
      { text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
      { text: '保存', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** Entry point for every "save offline" button / menu item. */
export async function requestOfflineSave(songs: SongItem[]): Promise<void> {
  const { ids } = useOffline.getState();
  const list = songs.filter((s) => !isLocalId(s.id) && !ids[s.id]);
  if (list.length === 0) {
    Alert.alert('保存する曲がありません', 'すべて保存済みか、端末内の曲です。');
    return;
  }
  if (!acknowledged() && !(await askAcknowledge())) return;
  if (list.length > 1 && !(await confirmMany(list.length))) return;
  useOffline.getState().save(list);
}
