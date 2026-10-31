import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleProp, Text, TextStyle, View } from 'react-native';

/** a title shorter than this stays still: only the longer ones move */
const SCROLL_FROM = 17;

/**
 * A long title (17 characters or more) that is too wide for its place: it waits, moves slowly from the start to the end,
 * and as soon as it has left the place it is back at the start. A short title, or one with `still`, stays still and is cut off.
 */
export function Marquee({ text, style, still = false, speed = 28, pause = 2200 }: { text: string; style?: StyleProp<TextStyle>; still?: boolean; speed?: number; pause?: number }) {
  const [box, setBox] = useState(0); // the width of the place
  const [full, setFull] = useState(0); // the width the whole title needs
  const x = useRef(new Animated.Value(0)).current;
  const scrolls = !still && Array.from(text).length >= SCROLL_FROM;
  const moves = scrolls && full > box;

  useEffect(() => {
    x.stopAnimation();
    x.setValue(0);
    if (!moves) return;
    // each round: wait at the start, move until the title has left the place completely, and when that is done
    // the title is set back to the start in the same moment (no reliance on a zero-length animation)
    let cancelled = false;
    let running: Animated.CompositeAnimation | undefined;
    const round = () => {
      if (cancelled) return;
      x.setValue(0);
      running = Animated.sequence([
        Animated.delay(pause),
        Animated.timing(x, { toValue: -full, duration: (full / speed) * 1000, easing: Easing.linear, useNativeDriver: true }),
      ]);
      running.start(({ finished }) => {
        if (finished) round();
      });
    };
    round();
    return () => {
      cancelled = true;
      running?.stop();
      x.setValue(0);
    };
  }, [moves, full, speed, pause, x]);

  if (!scrolls) {
    return (
      <Text style={style} numberOfLines={1}>
        {text}
      </Text>
    );
  }

  return (
    <View style={{ overflow: 'hidden' }} onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      {/* a wide, invisible copy only measures how wide the whole title is */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 4000, opacity: 0 }}>
        <Text style={style} onLayout={(e) => setFull(e.nativeEvent.layout.width)}>
          {text}
        </Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }], width: full > 0 ? full : undefined }}>
        <Text style={style} numberOfLines={1}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}
