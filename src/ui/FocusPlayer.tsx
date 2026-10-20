import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { TONE_LEVELS, type ToneLevel } from '../core/focus';
import { refreshTone, testEars } from '../player/tone';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { colors, useScheme } from './theme';

/** the beat (the difference between the ears) of the 集中 tone: the number that is shown big */
export const focusBeat = (): number => {
  const { left, right } = testEars();
  return Math.round(right - left);
};

/** the glow of a number: the colour of the accent around the letters */
export const glow = { textShadowColor: colors.accent, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 } as const;

/** the player for the 集中 sounds: a big Hz, the play button, the strength, and the description under a bar that opens upwards */
export function FocusPlayer() {
  useScheme();
  const router = useRouter();
  const current = usePlayer((p) => p.current);
  const status = usePlayer((p) => p.status);
  const togglePlay = usePlayer((p) => p.togglePlay);
  const level = useSettings((st) => st.focusToneLevel);
  const [open, setOpen] = useState(false);
  const beat = focusBeat();
  const playing = status === 'playing' || status === 'loading';

  const choose = (v: ToneLevel) => {
    useSettings.getState().update({ focusToneLevel: v });
    refreshTone();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#050508', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 24 }}>
      {/* the top: close and the menu */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable hitSlop={16} onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
      </View>

      {/* the big Hz, glowing */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text style={[glow, { color: colors.text, fontSize: 150, fontWeight: '200', lineHeight: 160 }]}>{beat}</Text>
          <Text style={[glow, { color: colors.text, fontSize: 36, fontWeight: '200', marginBottom: 26, marginLeft: 6 }]}>Hz</Text>
        </View>
        <Pressable
          onPress={() => void togglePlay()}
          accessibilityRole="button"
          style={{ marginTop: 28, width: 72, height: 72, borderRadius: 36, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={playing ? 'pause' : 'play'} size={30} color={colors.text} />
        </Pressable>
      </View>

      {/* the strength: オフ / 低 / 普通 / 高 */}
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.sub, fontSize: 12 }}>周波数強度</Text>
        <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
          {TONE_LEVELS.map((l) => {
            const on = l.value === level;
            return (
              <Pressable key={l.value} onPress={() => choose(l.value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: on ? colors.surface2 : 'transparent' }}>
                <Text style={{ color: on ? colors.text : colors.sub, fontWeight: on ? '700' : '400' }}>{l.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* the title, and the description: a bar that opens upwards */}
      <View style={{ marginTop: 22, gap: 2 }}>
        <Text style={{ color: colors.sub, fontSize: 12 }}>集中</Text>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>{current?.title ?? ''}</Text>
      </View>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ marginTop: 16, borderRadius: 14, backgroundColor: colors.surface2, padding: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>このサウンドスケープについて</Text>
          <Ionicons name={open ? 'chevron-down' : 'chevron-up'} size={18} color={colors.text} />
        </View>
        {open && <Text style={{ color: colors.sub, marginTop: 10, lineHeight: 22 }}>説明は準備中です。広い野原の画像と一緒に載せます。</Text>}
      </Pressable>
    </View>
  );
}
