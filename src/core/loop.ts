/**
 * Section loop (A-B repeat) and lyric-line loop. Pure logic: the player reports its position several times a second and
 * asks "do I have to jump back now?".
 */
export interface LoopRegion {
  /** seconds */
  start: number;
  end: number;
}

export const MIN_LOOP_SECONDS = 0.5;
/** jump slightly BEFORE the end: progress events arrive every 0.25 s, so waiting for the end would overshoot */
export const JUMP_LEAD = 0.1;
/** after a jump, positions reported while the seek is still completing are ignored */
export const SETTLE_MS = 700;
/** the last lyric line has no "next line": loop this much after it starts */
export const LAST_LINE_SECONDS = 8;

/** A and B in any order → a region, or null when it is too short / not valid */
export function makeLoop(a: number, b: number, durationSec?: number): LoopRegion | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const start = Math.max(0, Math.min(a, b));
  let end = Math.max(a, b);
  if (durationSec && durationSec > 0) end = Math.min(end, durationSec);
  return end - start >= MIN_LOOP_SECONDS ? { start, end } : null;
}

/** where to seek to, or null when playback simply goes on */
export function loopJumpTarget(position: number, loop: LoopRegion | null, nowMs: number, lastJumpMs: number): number | null {
  if (!loop || !Number.isFinite(position)) return null;
  if (nowMs - lastJumpMs < SETTLE_MS) return null;
  return position >= loop.end - JUMP_LEAD ? loop.start : null;
}

/** the region of one lyric line: from its start to the start of the next line */
export function lineRegion(lineTimesMs: number[], index: number, durationSec?: number): LoopRegion | null {
  const startMs = lineTimesMs[index];
  if (startMs === undefined || !Number.isFinite(startMs)) return null;
  const start = startMs / 1000;
  const nextMs = lineTimesMs.slice(index + 1).find((t) => Number.isFinite(t) && t > startMs);
  const end = nextMs !== undefined ? nextMs / 1000 : start + LAST_LINE_SECONDS;
  return makeLoop(start, end, durationSec);
}
