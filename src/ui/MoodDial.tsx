import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';

import { DIAL_OPTIONS, DIAL_STEP, angleFor, selectedIndex, type MoodOption } from '../core/mood';
import { colors, useScheme } from './theme';

const SIZE = 260;
const RADIUS = 96;
const KNOB = 62;

/**
 * A round dial: turn it with a drag, the option at the top is chosen when it stops.
 * `labels` replaces the option's own name (the first option shows the time of day).
 */
export function MoodDial({ labels, onChange }: { labels?: Partial<Record<string, string>>; onChange: (option: MoodOption, index: number) => void }) {
  useScheme();
  const rot = useRef(new Animated.Value(angleFor(0))).current;
  const start = useRef(0);
  const [angle, setAngle] = useState(angleFor(0));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = rot.addListener(({ value }) => setAngle(value));
    return () => rot.removeListener(id);
  }, [rot]);

  const settle = (target: number) => {
    const i = selectedIndex(target);
    Animated.spring(rot, { toValue: angleFor(i), useNativeDriver: false, friction: 9 }).start(() => {
      setIndex(i);
      onChange(DIAL_OPTIONS[i], i);
    });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          rot.stopAnimation((v) => {
            start.current = v;
          });
        },
        onPanResponderMove: (_, g) => rot.setValue(start.current + (g.dx - g.dy) * 0.6),
        onPanResponderRelease: (_, g) => settle(start.current + (g.dx - g.dy) * 0.6),
        onPanResponderTerminate: (_, g) => settle(start.current + (g.dx - g.dy) * 0.6),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rot],
  );

  const center = SIZE / 2;
  const current = DIAL_OPTIONS[index];
  const centerText = labels?.[current.key] ?? current.label;

  return (
    <View style={{ width: SIZE, height: SIZE, alignSelf: 'center' }} {...responder.panHandlers}>
      <View style={{ position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }} />
      {DIAL_OPTIONS.map((o, i) => {
        const deg = i * DIAL_STEP + angle;
        const rad = (deg * Math.PI) / 180;
        const x = center + RADIUS * Math.sin(rad) - KNOB / 2;
        const y = center - RADIUS * Math.cos(rad) - KNOB / 2;
        const on = i === index;
        return (
          <View
            key={o.key}
            style={{ position: 'absolute', left: x, top: y, width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.accent : colors.bg, borderWidth: 1, borderColor: colors.border }}
          >
            <Text numberOfLines={1} style={{ color: on ? colors.onAccent : colors.text, fontSize: 12, fontWeight: on ? '800' : '600' }}>
              {labels?.[o.key] ?? o.label}
            </Text>
          </View>
        );
      })}
      <View style={{ position: 'absolute', left: center - 58, top: center - 58, width: 116, height: 116, borderRadius: 58, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.bg }}>
        <Ionicons name="disc-outline" size={22} color={colors.accentText} />
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{centerText}</Text>
      </View>
    </View>
  );
}
