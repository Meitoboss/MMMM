import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProgress } from 'react-native-track-player';

import { isFocusId } from '../player/focus';
import { FocusBackdrop, focusBeat, glow } from './FocusPlayer';

import { useIsLiked, toggleLikeSong } from '../state/likes';
import { usePlayer } from '../state/player';
import { Cover } from './components';
import { MINI_HEIGHT, TAB_HEIGHT, colors, dynamicStyles, useScheme } from './theme';

/** screens that cover the whole screen (or have their own bottom buttons): the mini bar is not shown on them */
const FULL_SCREENS = ['player', 'archive-pick', 'add-to-playlist', 'song-tags'];

export function MiniPlayer() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { current, status, togglePlay, next, needsLoad, resumePosition, playerScreenOpen } = usePlayer();
  const { position, duration } = useProgress(1000);
  useScheme();
  const liked = useIsLiked(current?.id);

  if (!current || playerScreenOpen || FULL_SCREENS.includes(String(segments[0]))) return null;
  // on the 気分 tab the usual mini bar is hidden (the tab has its own card); the 集中 mini bar stays
  if (String((segments as string[])[1]) === 'mood' && !isFocusId(current.id)) return null;
  const inTabs = segments[0] === '(tabs)';
  // the 気分 screen has no tab bar, so the mini bar sits at the bottom edge there
  const onMood = String((segments as string[])[1]) === 'mood';
  const bottom = insets.bottom + (inTabs && !onMood ? TAB_HEIGHT : 0);
  const pct = needsLoad
    ? current.durationSec
      ? Math.min(1, (resumePosition ?? 0) / current.durationSec)
      : 0
    : duration > 0
      ? Math.min(1, position / duration)
      : 0;

  // the 集中 sounds: the Hz (the difference between the ears) glows, instead of the cover
  if (isFocusId(current.id)) {
    return (
      <Pressable onPress={() => router.push('/player')} style={[st.wrap, { bottom }]}>
        <FocusBackdrop id={current.id} dim={0.45} />
        <View style={[st.progress, { width: `${pct * 100}%` }]} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', minWidth: 64 }}>
          <Text style={[glow, { color: colors.text, fontSize: 28, fontWeight: '200' }]}>{focusBeat()}</Text>
          <Text style={[glow, { color: colors.text, fontSize: 13, fontWeight: '200', marginBottom: 4, marginLeft: 2 }]}>Hz</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.title} numberOfLines={1}>{current.title}</Text>
          <Text style={st.sub} numberOfLines={1}>集中 ・ ミュージック</Text>
        </View>
        <Pressable hitSlop={10} onPress={() => void togglePlay()}>
          <Ionicons name={status === 'playing' ? 'pause' : 'play'} size={28} color={colors.text} />
        </Pressable>
      </Pressable>
    );
  }

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
      <Pressable hitSlop={10} onPress={() => void toggleLikeSong(current)}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={24} color={liked ? colors.accentText : colors.text} />
      </Pressable>
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
