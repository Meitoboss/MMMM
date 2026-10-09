import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { appliedContent, emergencyContent, noteFromManifest, promptContent, shouldShowApplied } from '../core/updater';
import { lastSeenUpdateId, rememberSeenUpdateId, startUpdater, updaterActions, useUpdater } from '../state/updater';
import { colors, useScheme } from './theme';

type DownloadedInfo = { updateId?: string; manifest?: unknown } | undefined;
type RunningInfo = { manifest?: unknown } | undefined;

/**
 * Mount once, near the root. It
 *  - starts the looking for updates (at the start, when the app comes back to the front, now and then),
 *  - asks "apply now?" in a pop-up when a version has been downloaded (the way chosen in Settings),
 *  - shows a short "switching" screen, then reloads the app – without closing it,
 *  - says "updated" once, with what changed, the first time a new version runs.
 */
export function UpdatePromptHost() {
  useScheme();
  const u = Updates.useUpdates() as ReturnType<typeof Updates.useUpdates> & { downloadedUpdate?: DownloadedInfo; currentlyRunning?: RunningInfo };
  const prompt = useUpdater((s) => s.prompt);
  const phase = useUpdater((s) => s.phase);
  const asked = useRef<string | null>(null);

  useEffect(() => startUpdater(), []);

  // a version that the system downloaded by itself (when the app started): it is handled like any other
  const downloadedId = u.downloadedUpdate?.updateId ?? null;
  const downloadedNote = noteFromManifest(u.downloadedUpdate?.manifest);
  useEffect(() => {
    if (Updates.isEnabled && u.isUpdatePending && !useUpdater.getState().pending) updaterActions.observePending({ id: downloadedId ?? 'native', note: downloadedNote });
  }, [u.isUpdatePending, downloadedId, downloadedNote]);

  // the question
  useEffect(() => {
    if (!prompt || asked.current === prompt.id) return;
    asked.current = prompt.id;
    const c = promptContent(prompt.note, { playing: prompt.playing, working: false });
    Alert.alert(
      c.title,
      c.message,
      [
        { text: 'いま反映', onPress: () => updaterActions.accept() },
        { text: 'あとで', style: 'cancel', onPress: () => updaterActions.later() },
      ],
      { cancelable: false },
    );
  }, [prompt]);

  // once at the start: "what changed" (the first time this version runs), or "this version could not start"
  useEffect(() => {
    if (!Updates.isEnabled) return;
    if (Updates.isEmergencyLaunch) {
      const c = emergencyContent(Updates.emergencyLaunchReason ?? null);
      Alert.alert(c.title, c.message, [{ text: 'OK' }]);
      return;
    }
    const id = Updates.updateId ?? null;
    if (shouldShowApplied(lastSeenUpdateId(), id, Updates.isEmbeddedLaunch)) {
      const running = (u.currentlyRunning?.manifest ?? (Updates as unknown as { manifest?: unknown }).manifest) as unknown;
      const c = appliedContent(noteFromManifest(running));
      Alert.alert(c.title, c.message, [{ text: 'OK' }]);
      if (id) rememberSeenUpdateId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase !== 'switching') return null;
  return (
    <View testID="update-switching" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 1000 }]}>
      <ActivityIndicator size="large" color={colors.accentText} />
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>新しい版に切り替えています…</Text>
      <Text style={{ color: colors.sub, fontSize: 12 }}>アプリは、そのまま開いています</Text>
    </View>
  );
}
