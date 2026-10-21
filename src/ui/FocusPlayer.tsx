import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { TONE_LEVELS, type ToneLevel } from '../core/focus';
import { focusKeyOf, soundPitch } from '../player/focus';
import { refreshTone } from '../player/tone';
import { toggleLikeSong, useIsLiked } from '../state/likes';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { FOCUS_INFO, focusImage } from './focusImages';
import { colors, useScheme } from './theme';

/** the beat (the difference between the ears) of a 集中 sound: the number that is shown big, in Hz */
export const focusBeat = (id?: string): number => soundPitch(focusKeyOf(id ?? '')).beat;

/** the glow of a number: the colour of the accent around the letters */
export const glow = { textShadowColor: colors.accent, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 } as const;

/** a swipe in one direction (up or down) runs `onSwipe`: a short, mostly vertical move is enough */
export function useVerticalSwipe(direction: 'up' | 'down', onSwipe: () => void) {
  const handler = useRef({ onSwipe, direction });
  handler.current = { onSwipe, direction };
  return useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5 && (handler.current.direction === 'up' ? g.dy < 0 : g.dy > 0),
      onPanResponderRelease: (_, g) => {
        const passed = handler.current.direction === 'up' ? g.dy < -50 : g.dy > 50;
        if (passed) handler.current.onSwipe();
      },
    }),
  ).current.panHandlers;
}

/** the photo of the playing 集中 sound, dimmed so that the text reads over it */
export function FocusBackdrop({ id, opacity = 1, dim = 0.55 }: { id?: string; opacity?: number; dim?: number }) {
  const key = focusKeyOf(id ?? '');
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
  const swipeDown = useVerticalSwipe('down', onClose);
  const key = focusKeyOf(id ?? '');
  const info = FOCUS_INFO[key];
  const source = focusImage(key);
  const { width } = useWindowDimensions();
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View {...swipeDown} style={{ maxHeight: '86%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#101113', overflow: 'hidden' }}>
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

/** the time left on the timer, as text */
const leftText = (sleepAt: number, now: number): string => {
  const min = Math.max(1, Math.ceil((sleepAt - now) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ''}` : `${min}分`;
};

/** one column of the time picker: scrolls, and the number in the middle is the one chosen */
function WheelColumn({ max, value, onChange, unit }: { max: number; value: number; onChange: (v: number) => void; unit: string }) {
  const ITEM = 44;
  const ref = useRef<ScrollView>(null);
  const items = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <View style={{ width: 110, height: ITEM * 5, overflow: 'hidden' }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: value * ITEM }}
        contentContainerStyle={{ paddingVertical: ITEM * 2 }}
        onMomentumScrollEnd={(e) => onChange(Math.min(max, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM))))}
        onScrollEndDrag={(e) => onChange(Math.min(max, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM))))}
      >
        {items.map((n) => {
          const on = n === value;
          return (
            <View key={n} style={{ height: ITEM, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: on ? colors.text : 'rgba(255,255,255,0.3)', fontSize: on ? 30 : 22, fontWeight: on ? '300' : '200' }}>{n}</Text>
              {on && <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>{unit}</Text>}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** the timer: a chip that shows the time left, and a sheet (シャットオフタイマー) to choose how long the sound plays */
function TimerChip() {
  const sleepAt = usePlayer((p) => p.sleepAt);
  const setSleepTimer = usePlayer((p) => p.setSleepTimer);
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(5);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!sleepAt) return;
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [sleepAt]);
  const now = Date.now();
  const active = !!sleepAt && sleepAt > now;
  const total = hours * 60 + minutes;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="シャットオフタイマー"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, backgroundColor: active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: active ? colors.text : 'transparent' }}
      >
        <Ionicons name="timer-outline" size={18} color={colors.text} />
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{active ? `あと${leftText(sleepAt!, now)}` : 'シャットオフ'}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: 'rgba(18,18,22,0.96)', paddingHorizontal: 24, paddingTop: 22, paddingBottom: 40, gap: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            {/* the title row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name="timer-outline" size={26} color={colors.text} />
                <Text style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>シャットオフタイマー</Text>
              </View>
              <Pressable hitSlop={12} onPress={() => setOpen(false)}>
                <Ionicons name="chevron-down" size={22} color={colors.text} />
              </Pressable>
            </View>
            <Text style={{ color: colors.sub, fontSize: 14 }}>集中の再生を停止するタイマーを設定：</Text>

            {/* the time picker: hours and minutes, with the chosen one in the middle */}
            <View style={{ alignItems: 'center', justifyContent: 'center', height: 230 }}>
              <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, top: 93, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)' }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <WheelColumn max={12} value={hours} onChange={setHours} unit="時間" />
                <WheelColumn max={59} value={minutes} onChange={setMinutes} unit="分" />
              </View>
            </View>

            {/* start, or cancel a running one */}
            <Pressable
              disabled={total === 0}
              onPress={() => { setSleepTimer(total); setOpen(false); }}
              style={{ alignSelf: 'center', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 26, borderWidth: 1, borderColor: total === 0 ? 'rgba(255,255,255,0.15)' : colors.text, opacity: total === 0 ? 0.4 : 1 }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>タイマー開始</Text>
            </Pressable>
            {active && (
              <Pressable onPress={() => { setSleepTimer(null); setOpen(false); }} style={{ alignSelf: 'center' }}>
                <Text style={{ color: colors.sub, fontSize: 14 }}>タイマーを解除</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

/** the player for the 集中 sounds: the photo, a big thin Hz, the play circle, the strength, and the description under a bar that opens upwards */
export function FocusPlayer() {
  useScheme();
  const router = useRouter();
  const current = usePlayer((p) => p.current);
  const status = usePlayer((p) => p.status);
  const togglePlay = usePlayer((p) => p.togglePlay);
  const level = useSettings((st) => st.focusToneLevel);
  const [open, setOpen] = useState(false);
  // the swipes of this screen are for the description only: up opens it, down closes it.
  // Closing the player is by the ✕ button (no swipe), so it does not compete with the swipe up
  const openNow = useRef(open);
  openNow.current = open;
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (g.dy < -50) setOpen(true);
        else if (g.dy > 50 && openNow.current) setOpen(false);
      },
    }),
  ).current.panHandlers;
  const beat = focusBeat(current?.id);
  const playing = status === 'playing' || status === 'loading';
  const info = FOCUS_INFO[focusKeyOf(current?.id ?? '')];

  const choose = (v: ToneLevel) => {
    useSettings.getState().update({ focusToneLevel: v });
    refreshTone();
  };

  return (
    <View {...swipe} style={{ flex: 1, backgroundColor: '#050508' }}>
      {/* the player is closed with the ✕ button: the screen's swipe-to-close is off, so it does not compete with the description swipe */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      <FocusBackdrop id={current?.id} />
      <View style={{ flex: 1, paddingTop: 52, paddingHorizontal: 24, paddingBottom: 28 }}>
        {/* the top: close and the menu */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Pressable hitSlop={16} onPress={() => router.back()}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
        </View>

        {/* the big Hz: thin, with the unit at the lower right */}
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={[glow, { color: colors.text, fontSize: 150, fontWeight: '100', lineHeight: 160 }]}>{beat}</Text>
          <Text style={[glow, { color: colors.text, fontSize: 40, fontWeight: '100', alignSelf: 'flex-end', marginTop: -6 }]}>Hz</Text>
        </View>

        {/* the play circle on the left, the heart on the right */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable
            onPress={() => void togglePlay()}
            accessibilityRole="button"
            style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 1, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={playing ? 'pause' : 'play'} size={30} color={colors.text} />
          </Pressable>
          <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel="お気に入り" onPress={() => current && void toggleLikeSong(current)}>
            <Ionicons name={useIsLiked(current?.id) ? 'heart' : 'heart-outline'} size={28} color={colors.text} />
          </Pressable>
        </View>

        {/* the sleep timer: how long the sound plays, shown as the time left */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22 }}>
          <TimerChip />
        </View>

        {/* the title */}
        <View style={{ marginTop: 22, gap: 2 }}>
          <Text style={{ color: colors.sub, fontSize: 13 }}>集中</Text>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{current?.title ?? ''}</Text>
          {!!info && (
            <Text numberOfLines={2} style={{ color: colors.sub, fontSize: 14, lineHeight: 21, marginTop: 4 }}>
              {info.short}
            </Text>
          )}
        </View>

        {/* the strength: オフ / 低 / 普通 / 高 */}
        <View style={{ marginTop: 18, flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 26, overflow: 'hidden' }}>
          {TONE_LEVELS.map((l) => {
            const on = l.value === level;
            return (
              <Pressable key={l.value} onPress={() => choose(l.value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 26, backgroundColor: on ? 'rgba(255,255,255,0.12)' : 'transparent', borderWidth: on ? 1 : 0, borderColor: colors.text }}>
                <Text style={{ color: on ? colors.text : colors.sub, fontWeight: on ? '700' : '400' }}>{l.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* the description: a bar that opens upwards (swipe up also works) */}
        <Pressable onPress={() => setOpen(true)} style={{ marginTop: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', padding: 16 }}>
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
