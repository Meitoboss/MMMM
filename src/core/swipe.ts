/** Swiping a screen down to close it: when a drag counts as one, and how it ends. */
export const START_DISTANCE = 12;
const CLOSE_DISTANCE = 140;
const FLICK_SPEED = 0.8;

import { type SeekBand, touchOnSeekBar } from './seekDrag';

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

export type GateWhy = 'ok' | 'seek-bar' | 'list-scrolled';

/**
 * May a touch that began at height `touchY` start a swipe that closes the screen?
 *  - not on the seek bar (Android: the slider and the swipe would fight over the touch) – `seekBand` is null where that does not apply;
 *  - not when a list is scrolled down: it must scroll back up first (the top bar, above `topLimit`, always may).
 */
export function swipeGate(o: { touchY: number; seekBand: SeekBand | null; listTop: number; topLimit: number }): { ok: boolean; why: GateWhy } {
  if (touchOnSeekBar(o.touchY, o.seekBand)) return { ok: false, why: 'seek-bar' };
  if (o.listTop <= 2 || o.touchY < o.topLimit) return { ok: true, why: 'ok' };
  return { ok: false, why: 'list-scrolled' };
}

/** a line for the on-screen log: what a touch did, in a few words */
export const swipeLine = {
  touch: (y: number) => `swipe: touch y=${Math.round(y)}`,
  move: (dx: number, dy: number, vertical: boolean, gate: { ok: boolean; why: string }) => `swipe: move dx=${Math.round(dx)} dy=${Math.round(dy)} down=${vertical ? 'yes' : 'no'} gate=${gate.ok ? 'ok' : gate.why}`,
  grabbed: () => 'swipe: taken (the screen follows the finger)',
  release: (dy: number, vy: number, outcome: 'close' | 'back') => `swipe: release dy=${Math.round(dy)} vy=${vy.toFixed(2)} -> ${outcome}`,
  terminated: () => 'swipe: taken away by the system',
};
