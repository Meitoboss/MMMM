import * as Updates from 'expo-updates';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { type OtaRunning, type OtaSnapshot, shortError } from '../core/ota';
import { usePlayer } from './player';
import { updaterActions, useUpdater } from './updater';

/**
 * Over-the-air updates for the screens: what is running, what is going on, and the two things a person can do –
 * look for an update now, and switch to a downloaded one. The app looks by itself (at the start, when it comes back to the
 * front, now and then) and, as chosen in Settings, asks / switches by itself / waits (state/updater.ts); these two buttons use
 * the same flow.
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
      const r = await updaterActions.checkNow();
      if (r === 'none') setNote('いまが最新です');
      else if (r === 'error') setFailure(useUpdater.getState().lastError ?? '確認できませんでした');
    } catch (e) {
      setFailure(shortError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  /** switch to the downloaded version now (the app stays open; music that is playing stops, so that is asked first) */
  const restart = useCallback(() => {
    const go = () => {
      if (!useUpdater.getState().pending) updaterActions.observePending({ id: 'native', note: null });
      updaterActions.accept();
    };
    if (usePlayer.getState().status !== 'playing') {
      go();
      return;
    }
    Alert.alert('いま反映しますか？', '再生中の音楽が、一度止まります（もう一度、再生してください）。', [
      { text: 'いま反映', onPress: go },
      { text: 'あとで', style: 'cancel' },
    ]);
  }, []);

  return { snapshot, running, runtimeVersion: Updates.runtimeVersion ?? null, busy, note, check, restart };
}
