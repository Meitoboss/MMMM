import { Alert } from 'react-native';
import { useEffect } from 'react';
import { useOta } from '../state/ota';

export function useOtaUpdateDialog() {
  const isUpdateAvailable = useOta((s) => s.isUpdateAvailable);

  useEffect(() => {
    if (!isUpdateAvailable) return;

    const timer = setTimeout(() => {
      Alert.alert(
        '更新があります',
        'アプリの新しいバージョンが利用可能です。今すぐ更新しますか？',
        [
          {
            text: 'あとで',
            onPress: () => {},
            style: 'cancel',
          },
          {
            text: '今すぐ更新',
            onPress: () => useOta.getState().applyUpdate(),
            style: 'default',
          },
        ]
      );
    }, 500);

    return () => clearTimeout(timer);
  }, [isUpdateAvailable]);
}
