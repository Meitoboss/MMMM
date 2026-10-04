import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Alert, PermissionsAndroid, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { clearLastCrash, readLastCrash } from '../src/crash';
import { openDb } from '../src/db/expo';
import { ensureFolders } from '../src/player/localFiles';
import { useOffline } from '../src/state/offline';
import { restoreResume, startResumeSaving } from '../src/state/resume';
import { ensurePlayer } from '../src/player/setup';
import { applySettings, useSettings } from '../src/state/settings';
import { DialogHost } from '../src/ui/dialogs';
import { EngineHost } from '../src/ui/EngineHost';
import { MiniPlayer } from '../src/ui/MiniPlayer';
import { colors, useScheme } from '../src/ui/theme';

export default function RootLayout() {
  const scheme = useScheme();
  useEffect(() => {
    applySettings(useSettings.getState());
    restoreResume(); // last session's queue, paused (nothing starts by itself)
    startResumeSaving();
    // the app closed unexpectedly last time: show why (one time)
    const crash = readLastCrash();
    if (crash) {
      Alert.alert('前回、アプリが異常終了しました', `${crash.message}\n\n${crash.stack}`.slice(0, 1200), [{ text: 'OK', onPress: clearLastCrash }]);
    }
    void openDb();
    void useOffline.getState().load();
    void ensureFolders(); // creates Documents/Music, which then shows up in the Files app
    void ensurePlayer();
    // Android 13+: the media notification (lock-screen controls) needs this permission
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
    }
  }, []);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: '800' },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="player" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="add-to-playlist" options={{ presentation: 'modal', title: 'プレイリストに追加' }} />
          <Stack.Screen name="import-playlist" options={{ title: 'プレイリストを取り込む' }} />
          <Stack.Screen name="album/[id]" options={{ title: '' }} />
          <Stack.Screen name="artist/[id]" options={{ title: '' }} />
          <Stack.Screen name="playlist/[id]" options={{ title: '' }} />
          <Stack.Screen name="local-playlist/[id]" options={{ title: 'プレイリスト' }} />
        </Stack>
        <MiniPlayer />
        <EngineHost />
        <DialogHost />
      </View>
    </SafeAreaProvider>
  );
}
