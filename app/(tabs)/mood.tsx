import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { FOCUS_SOUNDS, type FocusSound } from '../../src/core/focus';
import { TUNINGS } from '../../src/core/tuning';
import { focusKeyOf, isFocusId } from '../../src/player/focus';
import { pauseTone, playTone } from '../../src/player/tone';
import { usePlayer } from '../../src/state/player';
import { useSettings } from '../../src/state/settings';
import { leaveFocusOnBlur, toggleFocusSound } from '../../src/player/focusControl';
import { SoundCard } from '../../src/ui/SoundCard';
import { SCENARIO_ROWS } from '../../src/ui/scenarios';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

export default function MoodTab() {
  useScheme();
  const current = usePlayer((p) => p.current);
  const status = usePlayer((p) => p.status);
  // the key of the 集中 sound that is on (playing or loading)
  const playingKey = current && isFocusId(current.id) && (status === 'playing' || status === 'loading') ? focusKeyOf(current.id) : '';
  const router = useRouter();

  // the sine tone follows the 集中 sounds: it plays while they play, and stops when they pause or another song starts
  useEffect(() => {
    let last = '';
    return usePlayer.subscribe((st) => {
      const focus = !!st.current && isFocusId(st.current.id);
      const key = `${focus}|${st.status}|${st.current?.id ?? ''}`;
      if (key === last) return;
      last = key;
      const { focusToneLevel } = useSettings.getState();
      if (focus && st.status === 'playing' && st.current && focusToneLevel !== 'off') {
        void playTone(st.current.id);
      } else if (!focus || st.status === 'paused' || st.status === 'idle' || st.status === 'error' || focusToneLevel === 'off') {
        pauseTone();
      }
    });
  }, []);

  // leaving the 気分 tab: the 集中 sounds stop, and the music from before comes back
  useFocusEffect(useCallback(() => leaveFocusOnBlur(), []));

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: MINI_HEIGHT + 150, gap: 26 }}>
      {/* シナリオ: two rows of chips that slide sideways */}
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', paddingHorizontal: 16 }}>シナリオ</Text>
        {/* the two rows move together: one sideways scroll for both */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          <View style={{ gap: 8 }}>
            {SCENARIO_ROWS.map((row, r) => (
              <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
                {row.map((c) => (
                  <Pressable
                    key={c.label}
                    accessibilityRole="button"
                    onPress={() => router.push(`/scenario/${encodeURIComponent(c.label)}`)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: colors.surface2 }}
                  >
                    <Ionicons name={c.icon} size={18} color={colors.text} />
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* 脳をチューニング: one coloured card per kind of sound, sideways; a card opens its page */}
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', paddingHorizontal: 16 }}>脳をチューニング</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
          {TUNINGS.map((t) => (
            <Pressable
              key={t.key}
              accessibilityRole="button"
              onPress={() => router.push(`/tuning/${t.key}`)}
              style={{ width: 150, height: 190, borderRadius: 22, padding: 16, justifyContent: 'space-between', backgroundColor: t.color }}
            >
              <Ionicons name={t.icon as keyof typeof Ionicons.glyphMap} size={30} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>{t.title}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* the sections of the sounds, below the cards: one horizontal row of tall photo cards each */}
      {SECTIONS.map((sec) => {
        const cards = FOCUS_SOUNDS.filter((x) => x.group === sec.group);
        if (!cards.length) return null;
        return (
          <View key={sec.group} style={{ gap: 12 }}>
            <View style={{ gap: 6, paddingHorizontal: 16 }}>
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>{sec.title}</Text>
              <Text style={{ color: colors.sub, fontSize: 14, lineHeight: 21 }}>{sec.text}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
              {cards.map((sound) => (
                <SoundCard key={sound.key} sound={sound} width={210} playing={playingKey === sound.key} onPress={() => void toggleFocusSound(sound)} />
              ))}
            </ScrollView>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** the sections under the 脳をチューニング cards: the group of each sound, with its heading and line */
const SECTIONS: { title: string; text: string; group: FocusSound['group'] }[] = [
  { title: '仕事・勉強', text: 'アルファ/ベータ波（8-30Hz）がタスクへの注意力を高めます。', group: 'focus' },
  { title: '深い眠り', text: '0.5-7Hzの波がアンビエントメロディーを通じて流れ、眠る前の日常の緊張を解放します。', group: 'sleep' },
  { title: '自然の旅', text: '自然の音とともに、心を遠くへ旅させるサウンドです。', group: 'nature' },
];
