import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';

import { DIAL_OPTIONS, DIAL_STEP, angleFor, selectedIndex, type MoodOption } from '../core/mood';
import { colors, useScheme } from './theme';

const SIZE = 340;
const RADIUS = 124;
const KNOB = 82;
const CENTER = 150;

/** the angle of a point around the dial's center, in degrees (0 = straight up, clockwise) */
const touchAngle = (x: number, y: number, cx: number, cy: number) => (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
/** the smallest turn from one angle to another, between -180 and 180 */
const turnBetween = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/**
 * A round dial: turn it with a finger that moves around it, the option at the top is chosen when it stops.
 * The dial keeps the touch while it is turned, so a list it sits in does not scroll instead.
 * `labels` replaces the option's own name (the first option shows the time of day).
 */
export function MoodDial({ labels, onChange }: { labels?: Partial<Record<string, string>>; onChange: (option: MoodOption, index: number) => void }) {
  useScheme();
  const ref = useRef<View>(null);
  const rot = useRef(new Animated.Value(angleFor(0))).current;
  const rotNow = useRef(angleFor(0));
  // the dial's center in page coordinates – the same coordinates the touch events use
  const center = useRef<{ x: number; y: number } | null>(null);
  // where the finger was when the turn started, and the dial's angle then
  const anchor = useRef<{ touch: number; rot: number } | null>(null);
  const [angle, setAngle] = useState(angleFor(0));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = rot.addListener(({ value }) => {
      rotNow.current = value;
      setAngle(value);
    });
    return () => rot.removeListener(id);
  }, [rot]);

  const measureCenter = () => {
    ref.current?.measure((_x, _y, w, h, px, py) => {
      center.current = { x: px + w / 2, y: py + h / 2 };
    });
  };

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
        // claim the touch before a list around the dial can scroll, and keep it while turning
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          rot.stopAnimation();
          anchor.current = null;
          measureCenter();
        },
        onPanResponderMove: (evt) => {
          const c = center.current;
          if (!c) return;
          const { pageX, pageY } = evt.nativeEvent;
          const t = touchAngle(pageX, pageY, c.x, c.y);
          if (!anchor.current) {
            anchor.current = { touch: t, rot: rotNow.current };
            return;
          }
          // follow the finger around the circle: the turn is the change of its angle, so going round past the bottom keeps the same direction
          rot.setValue(anchor.current.rot + turnBetween(anchor.current.touch, t));
        },
        onPanResponderRelease: () => settle(rotNow.current),
        onPanResponderTerminate: () => settle(rotNow.current),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rot],
  );

  const current = DIAL_OPTIONS[index];
  const centerText = labels?.[current.key] ?? current.label;

  return (
    <View ref={ref} onLayout={measureCenter} style={{ width: SIZE, height: SIZE, alignSelf: 'center' }} {...responder.panHandlers}>
      <View style={{ position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }} />
      {DIAL_OPTIONS.map((o, i) => {
        const rad = ((i * DIAL_STEP + angle) * Math.PI) / 180;
        const x = SIZE / 2 + RADIUS * Math.sin(rad) - KNOB / 2;
        const y = SIZE / 2 - RADIUS * Math.cos(rad) - KNOB / 2;
        const on = i === index;
        return (
          <View
            key={o.key}
            style={{ position: 'absolute', left: x, top: y, width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.accent : colors.bg, borderWidth: 1, borderColor: colors.border }}
          >
            <Text numberOfLines={1} style={{ color: on ? colors.onAccent : colors.text, fontSize: 13, fontWeight: on ? '800' : '600' }}>
              {labels?.[o.key] ?? o.label}
            </Text>
          </View>
        );
      })}
      <View style={{ position: 'absolute', left: SIZE / 2 - CENTER / 2, top: SIZE / 2 - CENTER / 2, width: CENTER, height: CENTER, borderRadius: CENTER / 2, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.bg }}>
        <Ionicons name="disc-outline" size={26} color={colors.accentText} />
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>{centerText}</Text>
      </View>
    </View>
  );
}
