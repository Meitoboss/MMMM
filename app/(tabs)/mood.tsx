import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { FOCUS_SOUNDS, type FocusSound } from '../../src/core/focus';
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

  const sections: { title: string; group: FocusSound['group'] }[] = [
    { title: '集中', group: 'focus' },
    { title: '回復', group: 'sleep' },
  ];

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: MINI_HEIGHT + 150, gap: 22 }}>
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

      {sections.map((sec) => {
        const cards = FOCUS_SOUNDS.filter((x) => x.group === sec.group);
        if (!cards.length) return null;
        return (
          <View key={sec.group} style={{ gap: 12 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', paddingHorizontal: 16 }}>{sec.title}</Text>
            {cards.map((sound) => (
              <View key={sound.key} style={{ gap: 10 }}>
                <SoundCard sound={sound} playing={playingKey === sound.key} onPress={() => void toggleFocusSound(sound)} />
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}
