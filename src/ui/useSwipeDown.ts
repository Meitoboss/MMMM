import { useMemo, useRef } from 'react';
import { Animated, PanResponder, useWindowDimensions } from 'react-native';

import { START_DISTANCE, startsSwipeDown, swipeLine, swipeOutcome } from '../core/swipe';

/**
 * Swipe a screen down to close it – from ANYWHERE on it. Put `panHandlers` on the whole screen and `translateY` on it: the
 * screen follows the finger, then closes or springs back.
 *
 * The swipe is noticed on the way DOWN to whatever was touched (a button, the cover, a list), so nothing needs its own handler.
 * Only a drag that goes down and is mostly vertical counts, so a slider (sideways) is never taken, and a tap is not a swipe.
 * `canStart(y)`: a list that has been scrolled down must scroll up first (and not close the screen) – the caller says whether the
 * touch, which began at height `y` on the screen, may start a swipe (true / false, or with the reason: { ok, why }).
 * `report`: when given, every touch tells what happened to it, in a few lines (touch, first move, taken, release, taken away) –
 * for the on-screen log, to find out why a swipe does not work on a phone.
 */
export function useSwipeDown(
  onClose: () => void,
  canStart: (touchStartY: number) => boolean | { ok: boolean; why: string } = () => true,
  report?: (line: string) => void,
) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const canStartRef = useRef(canStart);
  canStartRef.current = canStart;
  const heightRef = useRef(height);
  heightRef.current = height;
  const startY = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  const told = useRef(false);
  const gateOf = (y: number): { ok: boolean; why: string } => {
    const r = canStartRef.current(y);
    return typeof r === 'boolean' ? { ok: r, why: r ? 'ok' : 'no' } : r;
  };

  const pan = useMemo(() => {
    const springBack = () => Animated.spring(translateY, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
    return PanResponder.create({
      // only listens (never claims) when a touch begins: where it began matters later
      onStartShouldSetPanResponderCapture: (e) => {
        startY.current = e.nativeEvent.pageY;
        told.current = false;
        reportRef.current?.(swipeLine.touch(startY.current));
        return false;
      },
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        const down = startsSwipeDown(g.dx, g.dy);
        const gate = gateOf(startY.current);
        // said once per touch: the first move that is long enough to decide anything
        if (!told.current && (Math.abs(g.dy) > START_DISTANCE || Math.abs(g.dx) > START_DISTANCE)) {
          told.current = true;
          reportRef.current?.(swipeLine.move(g.dx, g.dy, down, gate));
        }
        return down && gate.ok;
      },
      onPanResponderGrant: () => reportRef.current?.(swipeLine.grabbed()),
      // once it is a swipe, a list underneath must not take it back
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        // closing keeps the screen where the finger left it: the system's closing animation carries it on down
        const outcome = swipeOutcome(g.dy, g.vy, heightRef.current);
        reportRef.current?.(swipeLine.release(g.dy, g.vy, outcome));
        if (outcome === 'close') closeRef.current();
        else springBack();
      },
      onPanResponderTerminate: () => {
        reportRef.current?.(swipeLine.terminated());
        springBack();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { panHandlers: pan.panHandlers, translateY };
}
