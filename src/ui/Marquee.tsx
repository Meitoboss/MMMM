import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleProp, Text, TextStyle, View } from 'react-native';

/** a title shorter than this stays still: only the longer ones move */
const SCROLL_FROM = 17;
const TICK_MS = 33;

/**
 * A long title (17 characters or more) that is too wide for its place: it waits at the start, moves slowly to the left until
 * it has left the place completely, and at that moment it is back at the start. A short title, or one with `still`, stays
 * still and is cut off. The position is worked out from the time (no animation library), so the return always happens.
 */
export function Marquee({ text, style, still = false, speed = 28, pause = 2200 }: { text: string; style?: StyleProp<TextStyle>; still?: boolean; speed?: number; pause?: number }) {
  const [box, setBox] = useState(0); // the width of the place
  const [full, setFull] = useState(0); // the width the whole title needs
  const [offset, setOffset] = useState(0); // how far the title has moved to the left (0 = at the start)
  const scrolls = !still && Array.from(text).length >= SCROLL_FROM;
  const moves = scrolls && full > 0 && full > box;

  useEffect(() => {
    setOffset(0);
    if (!moves) return;
    let begins = Date.now() + pause; // the movement starts after the pause at the start
    const id = setInterval(() => {
      const elapsed = Date.now() - begins;
      if (elapsed < 0) {
        setOffset(0);
        return;
      }
      const moved = (elapsed / 1000) * speed;
      if (moved >= full) {
        // gone from the place: back at the start, and the pause begins again
        begins = Date.now() + pause;
        setOffset(0);
        return;
      }
      setOffset(-moved);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [moves, full, speed, pause]);

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
      <View style={{ width: full > 0 ? full : undefined, transform: [{ translateX: offset }] }}>
        <Text style={style} numberOfLines={1}>
          {text}
        </Text>
      </View>
    </View>
  );
}
