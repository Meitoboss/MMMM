import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProgress } from 'react-native-track-player';

import { usePlayer } from '../state/player';
import { Cover } from './components';
import { MINI_HEIGHT, TAB_HEIGHT, colors } from './theme';

export function MiniPlayer() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { current, status, togglePlay, next } = usePlayer();
  const { position, duration } = useProgress(1000);

  if (!current || segments[0] === 'player') return null;
  const inTabs = segments[0] === '(tabs)';
  const bottom = insets.bottom + (inTabs ? TAB_HEIGHT : 0);
  const pct = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <Pressable onPress={() => router.push('/player')} style={[st.wrap, { bottom }]}>
      <View style={[st.progress, { width: `${pct * 100}%` }]} />
      <Cover uri={current.thumbnail} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={st.title} numberOfLines={1}>{current.title}</Text>
        <Text style={st.sub} numberOfLines={1}>{status === 'loading' ? 'Loading…' : status === 'error' ? 'Playback error – tap to retry' : current.artists.map((a) => a.name).join(', ')}</Text>
      </View>
      <Pressable hitSlop={10} onPress={() => void togglePlay()}>
        <Ionicons name={status === 'playing' ? 'pause' : 'play'} size={28} color={colors.text} />
      </Pressable>
      <Pressable hitSlop={10} onPress={() => void next()}>
        <Ionicons name="play-skip-forward" size={24} color={colors.text} />
      </Pressable>
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 8, right: 8, height: MINI_HEIGHT - 8, borderRadius: 12, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, overflow: 'hidden' },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2, backgroundColor: colors.accent },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sub: { color: colors.sub, fontSize: 12 },
});
