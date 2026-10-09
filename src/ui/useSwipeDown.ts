import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Platform, useWindowDimensions } from 'react-native';

import { startsSwipeDown, swipeOutcome } from '../core/swipe';

/**
 * Swipe a screen down to close it – from ANYWHERE on it. Put `panHandlers` on the whole screen and `translateY` on it: the
 * screen follows the finger, then closes or springs back.
 *
 * The swipe is noticed on the way DOWN to whatever was touched (a button, the cover, a list), so nothing needs its own handler.
 * Only a drag that goes down and is mostly vertical counts, so a slider (sideways) is never taken, and a tap is not a swipe.
 * `canStart(y)`: a list that has been scrolled down must scroll up first (and not close the screen) – the caller says whether the
 * touch, which began at height `y` on the screen, may start a swipe.
 *
 * iPhone: the screen is a native sheet (`presentation: 'modal'`), and the sheet has its own pull-down gesture. As soon as that
 * one notices the drag, iOS cancels the touch for JS – the screen sprang back and never closed. So there the system's gesture
 * closes the screen (`gestureEnabled` in app/_layout.tsx) and this hook stays out of its way (no handlers, no movement).
 */
export const SYSTEM_CLOSES_SHEET = Platform.OS === 'ios';

export function useSwipeDown(onClose: () => void, canStart: (touchStartY: number) => boolean = () => true) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const canStartRef = useRef(canStart);
  canStartRef.current = canStart;
  const heightRef = useRef(height);
  heightRef.current = height;
  const startY = useRef(0);

  const pan = useMemo(() => {
    const springBack = () => Animated.spring(translateY, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
    return PanResponder.create({
      // only listens (never claims) when a touch begins: where it began matters later
      onStartShouldSetPanResponderCapture: (e) => {
        startY.current = e.nativeEvent.pageY;
        return false;
      },
      onMoveShouldSetPanResponderCapture: (_e, g) => startsSwipeDown(g.dx, g.dy) && canStartRef.current(startY.current),
      // once it is a swipe, a list underneath must not take it back
      onPanResponderTerminationRequest: () => false,
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

  return { panHandlers: SYSTEM_CLOSES_SHEET ? {} : pan.panHandlers, translateY };
}
