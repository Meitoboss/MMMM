import * as Updates from 'expo-updates';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { type OtaRunning, type OtaSnapshot, shortError } from '../core/ota';

/**
 * Over-the-air updates for the screens: what is running, what is going on, and the two things a person can do –
 * look for an update now, and restart to use a downloaded one. (At start-up the app looks and downloads by itself;
 * a downloaded update is used from the NEXT start – never in the middle of a song.)
 */
export function useOta() {
  const u = Updates.useUpdates();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const snapshot: OtaSnapshot = {
    enabled: Updates.isEnabled,
    isChecking: Boolean(u.isChecking) || busy,
    isDownloading: Boolean(u.isDownloading),
    isUpdatePending: Boolean(u.isUpdatePending),
    error: failure ?? (u.checkError || u.downloadError || u.initializationError ? shortError(u.checkError ?? u.downloadError ?? u.initializationError) : null),
    emergencyReason: Updates.isEmergencyLaunch ? (Updates.emergencyLaunchReason || '理由は不明です') : null,
  };
  const running: OtaRunning = { isEmbedded: Updates.isEmbeddedLaunch, updateId: Updates.updateId, createdAt: Updates.createdAt, runtimeVersion: Updates.runtimeVersion };

  const check = useCallback(async () => {
    if (!Updates.isEnabled) return;
    setBusy(true);
    setFailure(null);
    setNote(null);
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) setNote('いまが最新です');
      else await Updates.fetchUpdateAsync();
    } catch (e) {
      setFailure(shortError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const restart = useCallback(() => {
    Alert.alert('再起動して反映しますか？', '再生中の音楽は止まります。', [
      { text: '再起動', onPress: () => void Updates.reloadAsync() },
      { text: 'あとで', style: 'cancel' },
    ]);
  }, []);

  return { snapshot, running, runtimeVersion: Updates.runtimeVersion ?? null, busy, note, check, restart };
}
