import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { openDb } from '../src/db/expo';
import { ensurePlayer } from '../src/player/setup';
import { applySettings, useSettings } from '../src/state/settings';
import { MiniPlayer } from '../src/ui/MiniPlayer';
import { colors } from '../src/ui/theme';

export default function RootLayout() {
  useEffect(() => {
    applySettings(useSettings.getState());
    void openDb();
    void ensurePlayer();
  }, []);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="player" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="add-to-playlist" options={{ presentation: 'modal', title: 'Add to playlist' }} />
          <Stack.Screen name="album/[id]" options={{ title: '' }} />
          <Stack.Screen name="artist/[id]" options={{ title: '' }} />
          <Stack.Screen name="playlist/[id]" options={{ title: '' }} />
          <Stack.Screen name="local-playlist/[id]" options={{ title: 'Playlist' }} />
        </Stack>
        <MiniPlayer />
      </View>
    </SafeAreaProvider>
  );
}
