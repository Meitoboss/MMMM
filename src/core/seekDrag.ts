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

/**
 * Where the seek bar is on the screen (top and bottom, in the same coordinates as a touch's pageY). A touch that BEGINS there is
 * the slider's, never a swipe that closes the screen. This is decided from the position – not from "a touch started / ended"
 * messages: on iPhone the slider's own touch handling can swallow the end of a touch, and a flag that is set at the start and cleared
 * at the end would then stay set, and the screen could never be swiped closed again.
 */
/** `top` / `bottom` are pageY values: what View.measure reports, and what a touch reports */
export interface SeekBand {
  top: number;
  bottom: number;
}

/** a little room above and below the thin bar, for a thumb that is not exactly on it */
export const SEEK_MARGIN = 10;

export function touchOnSeekBar(touchY: number, band: SeekBand | null): boolean {
  return !!band && touchY >= band.top - SEEK_MARGIN && touchY <= band.bottom + SEEK_MARGIN;
}

/**
 * A slider that is handed a new value (the playing position, twice a second) can report that value back through its own
 * "value changed" callback (Android does). That is an echo, not a finger. Told apart by size: the echo is the value we gave,
 * a finger moves it by more.
 */
export const ECHO_TOLERANCE = 0.75;
export const isEcho = (reported: number, given: number): boolean => Math.abs(reported - given) < ECHO_TOLERANCE;
