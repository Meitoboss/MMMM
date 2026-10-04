import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProgress } from 'react-native-track-player';

import { usePlayer } from '../state/player';
import { Cover } from './components';
import { MINI_HEIGHT, TAB_HEIGHT, colors, dynamicStyles, useScheme } from './theme';

export function MiniPlayer() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { current, status, togglePlay, next, needsLoad, resumePosition } = usePlayer();
  const { position, duration } = useProgress(1000);
  useScheme();

  if (!current || segments[0] === 'player') return null;
  const inTabs = segments[0] === '(tabs)';
  const bottom = insets.bottom + (inTabs ? TAB_HEIGHT : 0);
  const pct = needsLoad
    ? current.durationSec
      ? Math.min(1, (resumePosition ?? 0) / current.durationSec)
      : 0
    : duration > 0
      ? Math.min(1, position / duration)
      : 0;

  return (
    <Pressable onPress={() => router.push('/player')} style={[st.wrap, { bottom }]}>
      <View style={[st.progress, { width: `${pct * 100}%` }]} />
      <Cover uri={current.thumbnail} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={st.title} numberOfLines={1}>{current.title}</Text>
        <Text style={st.sub} numberOfLines={1}>
          {status === 'loading' ? '読み込み中…' : status === 'error' ? '再生エラー（タップで詳細）' : current.artists.map((a) => a.name).join(', ')}
        </Text>
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

const st = dynamicStyles((c) => ({
  wrap: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: MINI_HEIGHT - 8,
    borderRadius: 14,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2, backgroundColor: c.accent },
  title: { color: c.text, fontSize: 14, fontWeight: '600' },
  sub: { color: c.sub, fontSize: 12 },
}));
