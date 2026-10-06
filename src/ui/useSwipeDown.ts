import { useMemo, useRef } from 'react';
import { Animated, PanResponder, useWindowDimensions } from 'react-native';

import { startsSwipeDown, swipeOutcome } from '../core/swipe';

/**
 * Swipe a screen down to close it. Put `panHandlers` on the parts that may start the swipe (not on sliders or lists),
 * and `translateY` on the screen: it follows the finger, then closes or springs back.
 */
export function useSwipeDown(onClose: () => void) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const heightRef = useRef(height);
  heightRef.current = height;

  const pan = useMemo(() => {
    const springBack = () => Animated.spring(translateY, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => startsSwipeDown(g.dx, g.dy),
      onPanResponderMove: (_e, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        // closing keeps the screen where the finger left it: the system's closing animation carries it on down
        if (swipeOutcome(g.dy, g.vy, heightRef.current) === 'close') closeRef.current();
        else springBack();
      },
      onPanResponderTerminate: springBack,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { panHandlers: pan.panHandlers, translateY };
}
