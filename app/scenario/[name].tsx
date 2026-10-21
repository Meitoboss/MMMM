import { useFocusEffect, useLocalSearchParams, Stack } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { FOCUS_SOUNDS } from '../../src/core/focus';
import { leaveFocusOnBlur, toggleFocusSound } from '../../src/player/focusControl';
import { focusKeyOf, isFocusId } from '../../src/player/focus';
import { usePlayer } from '../../src/state/player';
import { SoundCard } from '../../src/ui/SoundCard';
import { SCENARIO_SUBTITLE, scenarioIcon } from '../../src/ui/scenarios';
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
  const { width } = useWindowDimensions();
  const cardWidth = (width - 16 * 2 - 12) / 2;

  // leaving this screen: the 集中 sounds stop, and the music from before comes back
  useFocusEffect(useCallback(() => leaveFocusOnBlur(), []));

  return (
    <>
      <Stack.Screen options={{ title: scenario }} />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: MINI_HEIGHT + 24, gap: 14 }}>
        {/* the header: the icon of the シナリオ, its name, and a short line */}
        <View style={{ alignItems: 'center', gap: 14, paddingVertical: 24, paddingHorizontal: 24 }}>
          {!!scenarioIcon(scenario) && <Ionicons name={scenarioIcon(scenario)!} size={64} color={colors.text} />}
          <Text style={{ color: colors.text, fontSize: 30, fontWeight: '800', textAlign: 'center' }}>{scenario}</Text>
          {!!SCENARIO_SUBTITLE[scenario] && <Text style={{ color: colors.sub, fontSize: 15, textAlign: 'center' }}>{SCENARIO_SUBTITLE[scenario]}</Text>}
        </View>
        {sounds.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 }}>
            {sounds.map((sound) => (
              <SoundCard key={sound.key} sound={sound} width={cardWidth} playing={playingKey === sound.key} onPress={() => void toggleFocusSound(sound)} />
            ))}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
            <Text style={{ color: colors.sub }}>「{scenario}」の曲は、まだありません。</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}
