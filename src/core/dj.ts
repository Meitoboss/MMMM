/**
 * DJ-style helpers, pure logic: hot cues, start / end trim of a song, and the fade between songs.
 * (The player plays ONE song at a time, so a "transition" is: fade out → next song → fade in. There is no overlap.)
 */
export const HOT_CUE_SLOTS = 8;

export interface HotCue {
  /** 0 … HOT_CUE_SLOTS-1 */
  slot: number;
  /** seconds */
  position: number;
  label?: string;
}

export const isCueSlot = (slot: number): boolean => Number.isInteger(slot) && slot >= 0 && slot < HOT_CUE_SLOTS;

/** the part of a song that is played: from `startSec` (skip the intro) to `endSec` (leave the outro out) */
export interface Trim {
  startSec?: number;
  endSec?: number;
}

const MIN_PLAYED_SECONDS = 1;
const IGNORE_START_BELOW = 0.5;

/** Checks / repairs a trim. Returns null when nothing is left to trim. */
export function sanitizeTrim(start: number | null | undefined, end: number | null | undefined, durationSec?: number): Trim | null {
  let s = typeof start === 'number' && Number.isFinite(start) && start > IGNORE_START_BELOW ? start : undefined;
  let e = typeof end === 'number' && Number.isFinite(end) && end > 0 ? end : undefined;
  if (durationSec && durationSec > 0) {
    if (e !== undefined && e >= durationSec - 0.5) e = undefined; // an "end" at the end of the song trims nothing
    if (s !== undefined && s >= durationSec - MIN_PLAYED_SECONDS) s = undefined;
  }
  if (s !== undefined && e !== undefined && e - s < MIN_PLAYED_SECONDS) return null; // would leave less than a second
  if (s === undefined && e === undefined) return null;
  return { ...(s !== undefined ? { startSec: s } : {}), ...(e !== undefined ? { endSec: e } : {}) };
}

/** how often the volume is stepped during a fade */
export const FADE_STEP_MS = 100;
/** the next progress event may be this late – the fade is planned one event ahead so that it still starts on time */
export const FADE_LOOKAHEAD = 1.5;

/** equal-power curves (the sound does not seem to dip in the middle): t = 0 … 1 */
export function fadeGain(kind: 'in' | 'out', t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return kind === 'out' ? Math.cos((x * Math.PI) / 2) : Math.sin((x * Math.PI) / 2);
}

/**
 * When to start fading out. `position` / `endSec` in seconds (endSec: the song's end, or its trimmed end).
 * null = not yet (or there is nothing to fade). `startInMs` is how long to wait before the ramp begins.
 */
export function planFadeOut(position: number, endSec: number, fadeSec: number): { startInMs: number; durationMs: number } | null {
  if (!(fadeSec > 0) || !Number.isFinite(position) || !Number.isFinite(endSec)) return null;
  const remaining = endSec - position;
  if (remaining <= 0.15) return null; // too late to fade
  if (remaining > fadeSec + FADE_LOOKAHEAD) return null;
  return { startInMs: Math.max(0, (remaining - fadeSec) * 1000), durationMs: Math.min(fadeSec, remaining) * 1000 };
}

export const FADE_OPTIONS = [0, 2, 4, 6, 8] as const;
