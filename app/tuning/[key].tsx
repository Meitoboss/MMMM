import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { FOCUS_SOUNDS } from '../../src/core/focus';
import { tuningOf, type TuningKey } from '../../src/core/tuning';
import { glow } from '../../src/ui/FocusPlayer';
import { SoundCard } from '../../src/ui/SoundCard';
import { leaveFocusOnBlur, toggleFocusSound } from '../../src/player/focusControl';
import { focusKeyOf, isFocusId } from '../../src/player/focus';
import { usePlayer } from '../../src/state/player';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

/** one 脳をチューニング card: its colour at the top with the name glowing, then its sounds as cards */
export default function TuningScreen() {
  useScheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { key } = useLocalSearchParams<{ key: string }>();
  const tuning = tuningOf(String(key) as TuningKey);
  const current = usePlayer((p) => p.current);
  const status = usePlayer((p) => p.status);
  const playingKey = current && isFocusId(current.id) && (status === 'playing' || status === 'loading') ? focusKeyOf(current.id) : '';
  const sounds = FOCUS_SOUNDS.filter((x) => x.tuning === key);

  // leaving this page: the 集中 sounds stop, and the music from before comes back
  useFocusEffect(useCallback(() => leaveFocusOnBlur(), []));

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <ScrollView contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 40 }}>
        <View style={{ backgroundColor: tuning?.color ?? colors.surface2, paddingTop: 56, paddingBottom: 48, paddingHorizontal: 24, alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="戻る" hitSlop={12} style={{ position: 'absolute', left: 16, top: 52, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' }}>
            <Ionicons name="chevron-back" size={24} color="#ffffff" />
          </Pressable>
          {!!tuning && <Ionicons name={tuning.icon as keyof typeof Ionicons.glyphMap} size={40} color="#ffffff" />}
          <Text style={[glow, { color: '#ffffff', fontSize: 34, fontWeight: '300', marginTop: 8 }]}>{tuning?.title ?? ''}</Text>
        </View>

        <View style={{ backgroundColor: colors.bg, marginTop: -24, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 24, paddingBottom: 12, gap: 14 }}>
          <View style={{ paddingHorizontal: 20, gap: 6 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>おすすめ</Text>
            {!!tuning && <Text style={{ color: colors.sub, fontSize: 14, lineHeight: 21 }}>{tuning.description}</Text>}
          </View>
          {sounds.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
              {sounds.map((sound) => (
                <SoundCard key={sound.key} sound={sound} width={Math.min(200, width * 0.55)} playing={playingKey === sound.key} onPress={() => void toggleFocusSound(sound)} />
              ))}
            </ScrollView>
          ) : (
            <Text style={{ color: colors.sub, paddingHorizontal: 20, paddingTop: 12 }}>この脳のチューニングの曲は、まだありません。</Text>
          )}
        </View>
      </ScrollView>
    </>
  );
}
