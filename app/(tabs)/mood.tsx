import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { FOCUS_SOUNDS, type FocusSound } from '../../src/core/focus';
import type { SongItem } from '../../src/core/types';
import { focusIdOf, focusKeyOf, focusSongOf, isFocusId, soundPitch } from '../../src/player/focus';
import { pauseTone, playTone, refreshTone } from '../../src/player/tone';
import { usePlayer } from '../../src/state/player';
import { useSettings } from '../../src/state/settings';
import { FocusBackdrop, focusBeat } from '../../src/ui/FocusPlayer';
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

/** the pitch of each ear of the 集中 tone, changed on the spot while the 集中 sounds play (developer). Steps of 0.5 Hz; the new value is kept as the setting */
function EarHz() {
  const ears = useSettings((st) => st.focusEars);
  const move = (side: 'left' | 'right', step: number) => {
    const next = { ...ears, [side]: Math.min(500, Math.max(20, Math.round((ears[side] + step) * 10) / 10)) };
    useSettings.getState().update({ focusEars: next });
    refreshTone();
  };
  const button = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surface2 }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  const ear = (name: string, side: 'left' | 'right') => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: colors.sub, fontSize: 12 }}>{name}</Text>
      {button('−', () => move(side, -0.5))}
      <Text style={{ color: colors.text, fontWeight: '700', minWidth: 72, textAlign: 'center' }}>{ears[side]} Hz</Text>
      {button('+', () => move(side, 0.5))}
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 14, paddingHorizontal: 12 }}>
      {ear('左', 'left')}
      {ear('右', 'right')}
    </View>
  );
}

/** one card of a 気分 section: the photo, the beat in large, the name, and the button (準備中 until the sound is on the server) */
function SoundCard({ sound, playing, onPress }: { sound: FocusSound; playing: boolean; onPress: () => void }) {
  const id = focusIdOf(sound.key);
  const beat = focusBeat(id);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ marginHorizontal: 16, borderRadius: 22, overflow: 'hidden', backgroundColor: '#101113', padding: 20, minHeight: 170, justifyContent: 'space-between' }}
    >
      <FocusBackdrop id={id} dim={0.5} />
      <Text style={{ color: colors.text, fontSize: 56, fontWeight: '200' }}>{beat} Hz</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{sound.name}</Text>
          <Text style={{ color: colors.text, opacity: 0.8, fontSize: 12 }}>{sound.group === 'focus' ? '集中' : '睡眠'} ・ ミュージック</Text>
        </View>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{!sound.ready ? '準備中' : playing ? '止める' : '再生'}</Text>
      </View>
    </Pressable>
  );
}

/** 気分: the シナリオ chips, then the cards of each section; the 集中 and 睡眠 cards play their sounds on their own */
export default function MoodTab() {
  useScheme();
  const current = usePlayer((p) => p.current);
  const status = usePlayer((p) => p.status);
  // the key of the 集中 sound that is on (playing or loading)
  const playingKey = current && isFocusId(current.id) && (status === 'playing' || status === 'loading') ? focusKeyOf(current.id) : '';
  // the music that was playing before the 集中 sounds took over: it comes back, paused, where it was when the 気分 tab is left
  const before = useRef<{ queue: SongItem[]; index: number; position: number; shuffle: boolean; repeat: 'off' | 'all' | 'one' } | null>(null);

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

  // a tap on a card: its sound starts, or pauses (a sound that is not on the server yet cannot be played)
  const toggle = async (sound: FocusSound) => {
    if (!sound.ready) return;
    const player = usePlayer.getState();
    const isCurrent = !!player.current && focusKeyOf(player.current.id) === sound.key;
    if (isCurrent) {
      if (player.status === 'playing') {
        await player.togglePlay();
        pauseTone();
      } else {
        await player.togglePlay();
      }
      return;
    }
    if (player.current && !isFocusId(player.current.id)) {
      before.current = { queue: player.queue, index: player.index, position: await player.getPosition(), shuffle: player.shuffle, repeat: player.repeat };
    }
    usePlayer.setState({ shuffle: false });
    player.setRepeat('all');
    await player.playSongs([focusSongOf(sound.key)], 0);
  };

  // leaving the 気分 tab: the 集中 sounds stop, and the music from before comes back, paused where it was
  useFocusEffect(
    useCallback(() => {
      return () => {
        const player = usePlayer.getState();
        if (!player.current || !isFocusId(player.current.id)) return;
        pauseTone();
        void (async () => {
          if (player.status === 'playing') await player.togglePlay();
          const saved = before.current;
          before.current = null;
          if (!saved || !saved.queue.length) return;
          usePlayer.setState({ shuffle: saved.shuffle });
          player.setRepeat(saved.repeat);
          await player.playSongs(saved.queue, saved.index);
          await usePlayer.getState().seekTo(saved.position);
          if (usePlayer.getState().status === 'playing') await usePlayer.getState().togglePlay();
        })();
      };
    }, []),
  );

  const sections: { title: string; group: FocusSound['group'] }[] = [
    { title: '集中', group: 'focus' },
    { title: '睡眠', group: 'sleep' },
  ];

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

      {sections.map((sec) => {
        const cards = FOCUS_SOUNDS.filter((x) => x.group === sec.group);
        if (!cards.length) return null;
        return (
          <View key={sec.group} style={{ gap: 12 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', paddingHorizontal: 16 }}>{sec.title}</Text>
            {cards.map((sound) => (
              <View key={sound.key} style={{ gap: 10 }}>
                <SoundCard sound={sound} playing={playingKey === sound.key} onPress={() => void toggle(sound)} />
                {sound.key === 'focus_loop' && playingKey === sound.key && <EarHz />}
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}
