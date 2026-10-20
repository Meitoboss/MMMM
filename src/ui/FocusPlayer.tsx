import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { TONE_LEVELS, type ToneLevel } from '../core/focus';
import { refreshTone, testEars } from '../player/tone';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { FOCUS_INFO, focusImage } from './focusImages';
import { colors, useScheme } from './theme';

/** the beat (the difference between the ears) of the 集中 tone: the number that is shown big */
export const focusBeat = (): number => {
  const { left, right } = testEars();
  return Math.round(right - left);
};

/** the glow of a number: the colour of the accent around the letters */
export const glow = { textShadowColor: colors.accent, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 } as const;

/** the photo of the playing 集中 sound, dimmed so that the text reads over it */
export function FocusBackdrop({ id, opacity = 1, dim = 0.55 }: { id?: string; opacity?: number; dim?: number }) {
  const key = id?.replace(/^local:focus-/, '') ?? '';
  const source = focusImage(key);
  if (!source) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      <Image source={source} style={{ width: '100%', height: '100%', opacity }} contentFit="cover" />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: `rgba(5,5,8,${dim})` }} />
    </View>
  );
}

/** a row of dots that draws a sine wave (two of them, the ears), without an extra library */
function WaveDots({ width, hz }: { width: number; hz: number }) {
  const dots = 120;
  const cycles = Math.max(3, Math.round(hz / 3));
  return (
    <View style={{ height: 70, width, justifyContent: 'center' }}>
      {Array.from({ length: dots }).map((_, i) => {
        const x = (i / dots) * width;
        const y = 35 - Math.sin((i / dots) * cycles * 2 * Math.PI) * 28;
        const bright = i > dots * 0.15 && i < dots * 0.85;
        return <View key={i} style={{ position: 'absolute', left: x, top: y, width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: bright ? colors.text : colors.sub, opacity: bright ? 1 : 0.5 }} />;
      })}
    </View>
  );
}

/** the description: opens upwards from the bar at the bottom of the player */
function FocusInfoSheet({ id, title, beat, onClose }: { id?: string; title: string; beat: number; onClose: () => void }) {
  const key = id?.replace(/^local:focus-/, '') ?? '';
  const info = FOCUS_INFO[key];
  const source = focusImage(key);
  const { width } = useWindowDimensions();
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={{ maxHeight: '86%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#101113', overflow: 'hidden' }}>
        <ScrollView contentContainerStyle={{ padding: 22, gap: 16, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>このサウンドスケープについて</Text>
            <Pressable hitSlop={12} onPress={onClose}>
              <Ionicons name="chevron-down" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {source && <Image source={source} style={{ width: 52, height: 52, borderRadius: 10 }} contentFit="cover" />}
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 34, fontWeight: '300' }}>{beat} Hz</Text>
            <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' }}>
              <Text style={{ color: colors.text, fontSize: 13 }}>ベータ (β)</Text>
            </View>
          </View>

          <WaveDots width={Math.min(width - 44, 360)} hz={beat} />

          {info && <Text style={{ color: colors.sub, fontSize: 14, lineHeight: 22 }}>{info.text}</Text>}
          <View style={{ height: 1, backgroundColor: colors.border }} />

          {info && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
              {info.features.map((f) => (
                <View key={f.label} style={{ width: '50%', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name={f.icon} size={20} color={colors.text} />
                  <Text style={{ color: colors.text, fontSize: 14 }}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}
          {info && <Text style={{ color: colors.sub, fontSize: 14, lineHeight: 24 }}>{info.body}</Text>}
          {!info && <Text style={{ color: colors.sub }}>説明は準備中です。</Text>}
        </ScrollView>
      </View>
    </View>
  );
}

/** the player for the 集中 sounds: the photo, a big glowing Hz, the play button, the strength, and the description under a bar that opens upwards */
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
    <View style={{ flex: 1, backgroundColor: '#050508' }}>
      <FocusBackdrop id={current?.id} />
      <View style={{ flex: 1, paddingTop: 52, paddingHorizontal: 20, paddingBottom: 24 }}>
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
                <Pressable key={l.value} onPress={() => choose(l.value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: on ? 'rgba(255,255,255,0.14)' : 'transparent' }}>
                  <Text style={{ color: on ? colors.text : colors.sub, fontWeight: on ? '700' : '400' }}>{l.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* the title, and the description: a bar that opens upwards */}
        <View style={{ marginTop: 22, gap: 2 }}>
          <Text style={{ color: colors.sub, fontSize: 12 }}>集中 ・ ミュージック</Text>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>{current?.title ?? ''}</Text>
        </View>
        <Pressable onPress={() => setOpen(true)} style={{ marginTop: 16, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', padding: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>このサウンドスケープについて</Text>
            <Ionicons name="chevron-up" size={18} color={colors.text} />
          </View>
        </Pressable>
      </View>

      {open && <FocusInfoSheet id={current?.id} title={current?.title ?? ''} beat={beat} onClose={() => setOpen(false)} />}
    </View>
  );
}
