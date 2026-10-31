import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleProp, Text, TextStyle, View } from 'react-native';

/** a title shorter than this stays still: only the longer ones move */
const SCROLL_FROM = 17;
const TICK_MS = 33;
/** how fast the title flies back to the start (points a second) */
const REWIND_SPEED = 800;

/**
 * A long title (17 characters or more) that is too wide for its place: it waits at the start, moves slowly to the left until
 * it has left the place completely, and at that moment it is back at the start. A short title, or one with `still`, stays
 * still and is cut off. The title sits in a scroll view that is moved from code (no touch), so it is always drawn at the
 * place where it is, and the return to the start is a plain jump of the scroll position.
 */
export function Marquee({ text, style, still = false, speed = 28, pause = 2200 }: { text: string; style?: StyleProp<TextStyle>; still?: boolean; speed?: number; pause?: number }) {
  const [box, setBox] = useState(0); // the width of the place
  const [full, setFull] = useState(0); // the width the whole title needs
  const scroller = useRef<ScrollView>(null);
  const scrolls = !still && Array.from(text).length >= SCROLL_FROM;
  const moves = scrolls && full > 0 && full > box;

  useEffect(() => {
    scroller.current?.scrollTo({ x: 0, animated: false });
    if (!moves) return;
    // the rounds: wait at the start, move to the left until the title has left the place, then fly back to the start
    let phase: 'wait' | 'move' | 'back' = 'wait';
    let since = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const secs = (now - since) / 1000;
      if (phase === 'wait') {
        if (secs * 1000 >= pause) {
          phase = 'move';
          since = now;
        }
        return;
      }
      if (phase === 'move') {
        const moved = secs * speed;
        if (moved >= full) {
          phase = 'back';
          since = now;
          scroller.current?.scrollTo({ x: full, animated: false });
          return;
        }
        scroller.current?.scrollTo({ x: moved, animated: false });
        return;
      }
      // back: the title flies to the start quickly
      const at = full - secs * REWIND_SPEED;
      if (at <= 0) {
        phase = 'wait';
        since = now;
        scroller.current?.scrollTo({ x: 0, animated: false });
        return;
      }
      scroller.current?.scrollTo({ x: at, animated: false });
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
      {/* alignItems: the text keeps its own width here; without it the text is stretched to the 4000 px of this box */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 4000, opacity: 0, alignItems: 'flex-start' }}>
        <Text style={style} onLayout={(e) => setFull(e.nativeEvent.layout.width)}>
          {text}
        </Text>
      </View>
      {moves ? (
        // the empty space at the end lets the title scroll out completely
        <ScrollView ref={scroller} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: box }}>
          <Text style={[style, { width: full }]} numberOfLines={1}>
            {text}
          </Text>
        </ScrollView>
      ) : (
        <Text style={[style, full > 0 ? { width: full } : undefined]} numberOfLines={1}>
          {text}
        </Text>
      )}
    </View>
  );
}
