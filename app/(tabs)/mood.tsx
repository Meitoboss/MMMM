import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { FocusBackdrop } from '../../src/ui/FocusPlayer';
import { focusHzOfSong, focusSongs, isFocusId } from '../../src/player/focus';
import { pauseTone, playTone, setTestEars, testEars } from '../../src/player/tone';
import { usePlayer } from '../../src/state/player';
import { useSettings } from '../../src/state/settings';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

/** the シナリオ chips: two rows that slide sideways */
const SCENARIO_ROWS: { label: string; icon: keyof typeof Ionicons.glyphMap }[][] = [
  [
    { label: 'お気に入り', icon: 'heart' },
    { label: '作成', icon: 'create-outline' },
    { label: 'カラーノイズ', icon: 'color-palette-outline' },
    { label: '目覚め', icon: 'sunny-outline' },
    { label: '深い眠り', icon: 'moon-outline' },
    { label: 'ASMR', icon: 'ear-outline' },
    { label: 'ストレス解消', icon: 'leaf-outline' },
    { label: '夜のリセット', icon: 'time-outline' },
    { label: '瞑想', icon: 'ellipse-outline' },
    { label: '耳鳴り緩和', icon: 'ear-outline' },
    { label: '423hz スリープ', icon: 'bed-outline' },
  ],
  [
    { label: 'ADHD緩和', icon: 'radio-button-off-outline' },
    { label: '8Dオーディオ', icon: 'headset-outline' },
    { label: '528hz リラックス', icon: 'sparkles-outline' },
    { label: 'ディープワーク', icon: 'hardware-chip-outline' },
    { label: '考えすぎをやめる', icon: 'cloudy-outline' },
    { label: 'パワーナップ', icon: 'flash-outline' },
    { label: 'ディープフロー状態', icon: 'pulse-outline' },
    { label: '家事', icon: 'home-outline' },
    { label: '赤ちゃんのための睡眠', icon: 'happy-outline' },
  ],
];

/** the pitch of each ear of the 集中 tone, changed on the spot while the 集中 sounds play (developer) */
function EarHz({ ears, onChange }: { ears: { left: number; right: number }; onChange: (next: { left: number; right: number }) => void }) {
  const move = (side: 'left' | 'right', step: number) => {
    const next = { ...ears, [side]: Math.min(500, Math.max(20, ears[side] + step)) };
    setTestEars(next.left, next.right);
    onChange(next);
  };
  const button = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surface2 }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  const ear = (name: string, side: 'left' | 'right') => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: colors.sub, fontSize: 12 }}>{name}</Text>
      {button('−', () => move(side, -5))}
      <Text style={{ color: colors.text, fontWeight: '700', minWidth: 60, textAlign: 'center' }}>{ears[side]} Hz</Text>
      {button('+', () => move(side, 5))}
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 14, paddingHorizontal: 12 }}>
      {ear('左', 'left')}
      {ear('右', 'right')}
    </View>
  );
}

/** 気分: the 集中 sounds on their own. The screen has no tab bar and no header of its own: 左上の「戻る」 leaves it */
export default function MoodTab() {
  useScheme();
  // the 集中 sounds are on while one of them is the song playing (or loading)
  const focusOn = usePlayer((p) => !!p.current && isFocusId(p.current.id) && (p.status === 'playing' || p.status === 'loading'));
  const [ears, setEars] = useState(testEars);

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
        void playTone(focusHzOfSong(st.current.id) ?? 432);
      } else if (!focus || st.status === 'paused' || st.status === 'idle' || st.status === 'error' || focusToneLevel === 'off') {
        pauseTone();
      }
    });
  }, []);

  // a tap on the card: the 集中 sounds start (shuffled, never ending) or pause
  const toggleFocus = () => {
    const player = usePlayer.getState();
    if (focusOn) {
      void player.togglePlay();
      pauseTone();
      return;
    }
    const list = focusSongs();
    if (!list.length) return; // no focus sounds on the server yet
    usePlayer.setState({ shuffle: true });
    player.setRepeat('all');
    void player.playSongs(list, Math.floor(Math.random() * list.length));
  };

  const beat = ears.right - ears.left;

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: MINI_HEIGHT + 24, gap: 22 }}>
      {/* シナリオ: two rows of chips that slide sideways */}
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', paddingHorizontal: 16 }}>シナリオ</Text>
        {SCENARIO_ROWS.map((row, r) => (
          <ScrollView key={r} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
            {row.map((c) => (
              <Pressable
                key={c.label}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: colors.surface2 }}
              >
                <Ionicons name={c.icon} size={18} color={colors.text} />
                <Text style={{ color: colors.text, fontWeight: '600' }}>{c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ))}
      </View>

      <View style={{ gap: 12, paddingHorizontal: 16 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>集中</Text>
        <Pressable
          onPress={toggleFocus}
          accessibilityRole="button"
          style={{ borderRadius: 22, overflow: 'hidden', backgroundColor: '#101113', padding: 20, minHeight: 170, justifyContent: 'space-between' }}
        >
          <FocusBackdrop id={focusSongs()[0]?.id} dim={0.5} />
          <Text style={{ color: colors.text, fontSize: 56, fontWeight: '200' }}>{beat} Hz</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>広い野原</Text>
              <Text style={{ color: colors.text, opacity: 0.8, fontSize: 12 }}>集中 ・ ミュージック</Text>
            </View>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{focusOn ? '止める' : '再生'}</Text>
          </View>
        </Pressable>
        {focusOn && <EarHz ears={ears} onChange={setEars} />}
      </View>
    </ScrollView>
  );
}
