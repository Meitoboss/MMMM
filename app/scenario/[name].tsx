import { useFocusEffect, useLocalSearchParams, Stack } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { FOCUS_SOUNDS } from '../../src/core/focus';
import { leaveFocus, toggleFocusSound } from '../../src/player/focusControl';
import { focusKeyOf, isFocusId } from '../../src/player/focus';
import { usePlayer } from '../../src/state/player';
import { SoundCard } from '../../src/ui/SoundCard';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

/** one シナリオ: only the sounds that belong to it, each with its card */
export default function ScenarioScreen() {
  useScheme();
  const { name } = useLocalSearchParams<{ name: string }>();
  const scenario = decodeURIComponent(String(name ?? ''));
  const current = usePlayer((p) => p.current);
  const status = usePlayer((p) => p.status);
  const playingKey = current && isFocusId(current.id) && (status === 'playing' || status === 'loading') ? focusKeyOf(current.id) : '';
  const sounds = FOCUS_SOUNDS.filter((x) => x.scenarios.includes(scenario));

  // leaving this screen: the 集中 sounds stop, and the music from before comes back
  useFocusEffect(useCallback(() => leaveFocus, []));

  return (
    <>
      <Stack.Screen options={{ title: scenario }} />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: MINI_HEIGHT + 24, gap: 14 }}>
        {sounds.length ? (
          sounds.map((sound) => (
            <SoundCard key={sound.key} sound={sound} playing={playingKey === sound.key} onPress={() => void toggleFocusSound(sound)} />
          ))
        ) : (
          <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
            <Text style={{ color: colors.sub }}>「{scenario}」の曲は、まだありません。</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}
