/** Swiping a screen down to close it: when a drag counts as one, and how it ends. */
export const START_DISTANCE = 12;
const CLOSE_DISTANCE = 140;
const FLICK_SPEED = 0.8;

/** a drag that goes down and is mostly vertical (so a sideways slide on a slider never closes the screen) */
export function startsSwipeDown(dx: number, dy: number): boolean {
  return dy > START_DISTANCE && dy > Math.abs(dx) * 1.5;
}

/** dy in px, vy in px/ms (as PanResponder reports it) */
export function swipeOutcome(dy: number, vy: number, screenHeight: number): 'close' | 'back' {
  if (dy > Math.min(CLOSE_DISTANCE, screenHeight * 0.2)) return 'close';
  if (vy > FLICK_SPEED && dy > 40) return 'close'; // a quick flick does not need the full distance
  return 'back';
}
