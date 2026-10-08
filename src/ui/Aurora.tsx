import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { DRIFT, LAYERS, MIN_AURORA_HEIGHT, auroraMotion, layerOpacity } from '../core/auroraMotion';

const RIBBON = {
  red: require('../../assets/aurora-red.png'),
  purple: require('../../assets/aurora-purple.png'),
  green: require('../../assets/aurora-green.png'),
};
const BACKGROUND = require('../../assets/aurora-bg.png');
/** the ribbons are this many times as wide as the box; the drift slides the box along them */
const WIDTH_FACTOR = 2.5;

/**
 * The aurora of the original design, as a band. Paused: a calm, slow flow. Playing: it drifts faster and beats
 * (120 beats a minute, following the playback speed). Everything is moved by the native animation driver, so it costs
 * almost nothing, and it stands still when the phone asks for reduced motion.
 */
export function Aurora({ playing, rate = 1, style, testID }: { playing: boolean; rate?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [reduce, setReduce] = useState(false);
  const drift = useRef(LAYERS.map((l) => new Animated.Value(l.reverse ? 1 : 0))).current; // 0 … 1, back and forth
  const beat = useRef(new Animated.Value(0)).current; // 0 = rest … 1 = peak of a beat

  const visible = box.h >= MIN_AURORA_HEIGHT && box.w > 0;
  const motion = useMemo(() => auroraMotion({ playing, rate, reduceMotion: reduce }), [playing, rate, reduce]);

  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => on && setReduce(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      on = false;
      sub?.remove?.();
    };
  }, []);

  // the slow flow (faster while playing); a change of speed continues from where each ribbon is
  const driftKey = motion.driftMs.join(',');
  useEffect(() => {
    if (!visible || reduce) return;
    let cancelled = false;
    const running: Animated.CompositeAnimation[] = [];
    LAYERS.forEach((_l, i) => {
      const v = drift[i];
      v.stopAnimation((from) => {
        if (cancelled) return;
        const ms = motion.driftMs[i];
        const toward = from >= 0.5 ? 0 : 1;
        const other = toward === 1 ? 0 : 1;
        const ease = Easing.inOut(Easing.sin);
        const anim = Animated.sequence([
          Animated.timing(v, { toValue: toward, duration: Math.max(1, Math.abs(toward - from) * ms), easing: ease, useNativeDriver: true }),
          Animated.loop(
            Animated.sequence([
              Animated.timing(v, { toValue: other, duration: ms, easing: ease, useNativeDriver: true }),
              Animated.timing(v, { toValue: toward, duration: ms, easing: ease, useNativeDriver: true }),
            ]),
          ),
        ]);
        running.push(anim);
        anim.start();
      });
    });
    return () => {
      cancelled = true;
      running.forEach((a) => a.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduce, driftKey]);

  // the beat (only while playing)
  const beatPeriod = motion.beat?.periodMs ?? 0;
  useEffect(() => {
    if (!visible || !motion.beat) {
      beat.stopAnimation();
      Animated.timing(beat, { toValue: 0, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      return;
    }
    const { attackMs, releaseMs, pattern } = motion.beat;
    const loop = Animated.loop(
      Animated.sequence(
        pattern.flatMap((peak) => [
          Animated.timing(beat, { toValue: peak, duration: attackMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(beat, { toValue: 0, duration: releaseMs, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, beatPeriod]);

  const imageWidth = box.w * WIDTH_FACTOR;
  const layers = useMemo(
    () =>
      LAYERS.map((l, i) => ({
        l,
        opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [layerOpacity(l, 0), layerOpacity(l, 1)] }),
        x: drift[i].interpolate({ inputRange: DRIFT.input, outputRange: DRIFT.x.map((f) => f * imageWidth) }),
        y: drift[i].interpolate({ inputRange: DRIFT.input, outputRange: DRIFT.y.map((f) => f * box.h) }),
        rotate: drift[i].interpolate({ inputRange: DRIFT.input, outputRange: DRIFT.rotateDeg.map((d) => `${d}deg`) }),
        scale: drift[i].interpolate({ inputRange: DRIFT.input, outputRange: DRIFT.scale }),
        pulse: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + l.beatScale] }),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageWidth, box.h],
  );

  return (
    <View
      testID={testID}
      pointerEvents="none"
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[{ overflow: 'visible' }, style]}
    >
      {visible && (
        <>
          <Image source={BACKGROUND} resizeMode="stretch" style={StyleSheet.absoluteFill} />
          {layers.map(({ l, opacity, x, y, rotate, scale, pulse }) => (
            <Animated.Image
              key={l.key}
              testID={`aurora-${l.key}`}
              source={RIBBON[l.key]}
              resizeMode="stretch"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: imageWidth,
                height: box.h,
                opacity,
                transform: [{ translateX: x }, { translateY: y }, { rotate }, { scaleX: scale }, { scaleY: scale }, { scaleY: pulse }],
              }}
            />
          ))}
        </>
      )}
    </View>
  );
}
