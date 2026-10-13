import { Pressable, Text, View } from 'react-native';
import { useState } from 'react';

import { type BpmInfo, beatSeconds } from '../core/beat';
import type { Trim, HotCue } from '../core/dj';
import type { LoopRegion } from '../core/loop';
import { colors, useScheme } from './theme';

const fmt = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/**
 * The song as a bar: where the playhead is, the loop (shaded), the start and end (the parts that are not played are dimmed),
 * the A point and the cue points (numbers above the bar). Tap the bar to go to that place.
 */
export function DjTimeline({ duration, position, loop, loopA, trim, cues, onSeek }: { duration: number; position: number; loop: LoopRegion | null; loopA?: number; trim: Trim | null; cues: HotCue[]; onSeek: (sec: number) => void }) {
  useScheme();
  const [width, setWidth] = useState(0);
  const ready = duration > 0 && width > 0;
  const at = (sec: number) => (duration > 0 ? Math.max(0, Math.min(1, sec / duration)) * width : 0);
  const span = (a: number, b: number) => ({ left: at(a), width: Math.max(0, at(b) - at(a)) });
  return (
    <View testID="dj-timeline" style={{ gap: 2 }}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: 16 }}>
        {cues.map((c) => (
          <Text key={c.slot} style={{ position: 'absolute', left: Math.max(0, Math.min(width - 10, at(c.position) - 4)), top: 0, fontSize: 10, fontWeight: '800', color: colors.accentText }}>
            {c.slot + 1}
          </Text>
        ))}
      </View>
      <Pressable
        testID="dj-timeline-bar"
        disabled={!ready}
        onPress={(e) => ready && onSeek((Math.max(0, Math.min(1, e.nativeEvent.locationX / width))) * duration)}
        style={{ height: 36, justifyContent: 'center' }}
      >
        <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.surface2, overflow: 'hidden' }}>
          {loop && <View style={[{ position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.accent, opacity: 0.5 }, span(loop.start, loop.end)]} />}
          {trim?.startSec !== undefined && <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: at(trim.startSec), backgroundColor: colors.bg, opacity: 0.8 }} />}
          {trim?.endSec !== undefined && <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: Math.max(0, width - at(trim.endSec)), backgroundColor: colors.bg, opacity: 0.8 }} />}
        </View>
        {cues.map((c) => (
          <View key={c.slot} style={{ position: 'absolute', left: at(c.position) - 1, top: 9, width: 2, height: 18, borderRadius: 1, backgroundColor: colors.accentText }} />
        ))}
        {loopA !== undefined && <View style={{ position: 'absolute', left: at(loopA) - 1, top: 11, width: 2, height: 14, backgroundColor: colors.text, opacity: 0.8 }} />}
        <View style={{ position: 'absolute', left: at(position) - 1.5, top: 6, width: 3, height: 24, borderRadius: 2, backgroundColor: colors.text }} />
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.sub, fontSize: 12 }}>{fmt(position)}</Text>
        <Text style={{ color: colors.sub, fontSize: 12 }}>{duration > 0 ? fmt(duration) : '--:--'}</Text>
      </View>
    </View>
  );
}

/**
 * A light that flashes on each beat. It counts from the marked beat position (or from the start of the song when none is marked),
 * so it is only as exact as the BPM and the marked beat.
 */
export function BeatLight({ info, position, playing }: { info: BpmInfo | null; position: number; playing: boolean }) {
  useScheme();
  if (!info) return <Text style={{ color: colors.sub, fontSize: 12 }}>テンポを決めると、拍に合わせて光ります</Text>;
  const len = beatSeconds(info.bpm);
  const phase = ((((position - (info.anchor ?? 0)) % len) + len) % len) / len;
  const lit = playing && phase < 0.2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View testID="beat-light" style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: lit ? colors.accent : colors.surface2 }} />
      <Text style={{ color: colors.sub, fontSize: 12, flex: 1 }}>
        {info.anchor === undefined ? '拍の位置が未設定です。曲の始まりを拍として光ります' : '拍の位置に合わせて光ります'}
      </Text>
    </View>
  );
}
