/**
 * The seek bar while a finger is on it.
 *
 * On Android a slider whose value is rewritten from outside on every move (to follow the finger) fights the finger and cannot be
 * dragged. So while dragging, the value handed to the slider stays where the drag began (the slider follows the finger by itself);
 * the time shown next to it follows the finger. After the finger is lifted the chosen position is held for a moment, until the
 * player has caught up (it reports its position twice a second), so that the thumb does not jump back and forth.
 */
export interface Drag {
  /** where the thumb was when the finger touched it – the value given to the slider all through the drag */
  start: number;
  /** where the finger is now – what the time label shows */
  now: number;
}

/** the slider reported a new value: the first report of a drag begins it */
export function dragMoved(drag: Drag | null, value: number): Drag {
  return { start: drag ? drag.start : value, now: value };
}

/** the value handed to the slider */
export function sliderValue(drag: Drag | null, hold: number | null, live: number): number {
  return drag ? drag.start : hold ?? live;
}

/** the position shown in the time label */
export function shownPosition(drag: Drag | null, hold: number | null, live: number): number {
  return drag ? drag.now : hold ?? live;
}

/** how close the player's own position must be to the chosen one before the hold ends (seconds) */
export const HOLD_CLOSE = 1.5;
/** the longest the chosen position is held (ms), in case the player never reports a close position */
export const HOLD_MS = 1500;

export const holdReached = (hold: number | null, live: number): boolean => hold !== null && Math.abs(live - hold) < HOLD_CLOSE;
