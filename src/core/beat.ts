import { type LoopRegion, makeLoop } from './loop';

/**
 * Tempo (BPM), the beat grid, beat loops and tempo matching – pure logic.
 * The app cannot hear the music, so BPM is typed in or tapped along by the person; `anchor` is the time (in seconds) of one
 * beat that was marked, which lets loops start exactly ON a beat.
 */
export const MIN_BPM = 30;
export const MAX_BPM = 300;
/** the lengths of a beat loop, in beats */
export const BEAT_CHOICES = [1, 2, 4, 8, 16] as const;

export interface BpmInfo {
  bpm: number;
  /** seconds: the position of one beat (any beat – the grid repeats both ways) */
  anchor?: number;
}

export const validBpm = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM;
export const roundBpm = (v: number): number => Math.round(v * 10) / 10;
export const clampBpm = (v: number): number => roundBpm(Math.max(MIN_BPM, Math.min(MAX_BPM, v)));
export const formatBpm = (bpm: number): string => (Number.isInteger(roundBpm(bpm)) ? String(roundBpm(bpm)) : roundBpm(bpm).toFixed(1));
export const beatSeconds = (bpm: number): number => 60 / bpm;

/** typed text → BPM ("128", "127.5", full-width digits too); null when it is not a usable number */
export function parseBpmText(text: string): number | null {
  const half = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace('．', '.').trim();
  if (!half || !/^\d{1,3}(\.\d{1,2})?$/.test(half)) return null;
  const v = Number(half);
  return validBpm(v) ? roundBpm(v) : null;
}

/** ÷2 / ×2 (tapping often finds half or double of the tempo you feel); stays as it is when the result is out of range */
export function halveBpm(bpm: number): number {
  return validBpm(bpm / 2) ? roundBpm(bpm / 2) : bpm;
}
export function doubleBpm(bpm: number): number {
  return validBpm(bpm * 2) ? roundBpm(bpm * 2) : bpm;
}

/* ------------------------------------------------------------------ tapping the tempo ------------------------------------------------------------------ */
/** a pause longer than this starts a new count */
export const TAP_RESET_MS = 2500;
export const MIN_TAPS = 4;
const MAX_TAPS = 16;

/** adds a tap (time in ms); a long pause since the last tap starts over; only the latest taps are kept */
export function addTap(taps: number[], nowMs: number): number[] {
  const last = taps[taps.length - 1];
  const base = last !== undefined && (nowMs - last > TAP_RESET_MS || nowMs < last) ? [] : taps;
  return [...base, nowMs].slice(-MAX_TAPS);
}

/**
 * BPM from the tap times. Needs MIN_TAPS taps. A stray tap (an interval far from the typical one) is ignored.
 * @returns null while there is not enough to tell
 */
export function estimateBpm(taps: number[]): { bpm: number; taps: number } | null {
  if (taps.length < MIN_TAPS) return null;
  const intervals = taps.slice(1).map((t, i) => t - taps[i]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return null;
  const kept = intervals.filter((v) => v >= median * 0.7 && v <= median * 1.3);
  if (kept.length < MIN_TAPS - 2) return null;
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const bpm = roundBpm(60000 / mean);
  return validBpm(bpm) ? { bpm, taps: taps.length } : null;
}

/* ------------------------------------------------------------------ the beat grid and loops ------------------------------------------------------------------ */
/** the beat nearest to `position` (the position itself when no beat has been marked) */
export function nearestBeat(position: number, info: BpmInfo): number {
  if (info.anchor === undefined || !Number.isFinite(info.anchor)) return position;
  const len = beatSeconds(info.bpm);
  const t = info.anchor + Math.round((position - info.anchor) / len) * len;
  return t < 0 ? t + len * Math.ceil(-t / len) : t;
}

/**
 * A loop of `beats` beats that starts on the beat nearest to `position` (or exactly at `position` when no beat is marked).
 * null when it would be too short or does not fit into the song.
 */
export function beatLoopRegion(position: number, info: BpmInfo, beats: number, durationSec?: number): LoopRegion | null {
  if (!validBpm(info.bpm) || !(beats > 0) || !Number.isFinite(position)) return null;
  const start = Math.max(0, nearestBeat(position, info));
  const end = start + beats * beatSeconds(info.bpm);
  // a loop that does not fit is no loop (cutting it short would make "8 beats" something else)
  if (durationSec && durationSec > 0 && end > durationSec + 0.001) return null;
  return makeLoop(start, end, durationSec);
}

/** a loop twice / half as long, from the same start (null when it would become too short or run past the song) */
export function scaleLoopRegion(loop: LoopRegion, factor: number, durationSec?: number): LoopRegion | null {
  if (!(factor > 0)) return null;
  const end = loop.start + (loop.end - loop.start) * factor;
  if (durationSec && durationSec > 0 && end > durationSec + 0.001) return null;
  return makeLoop(loop.start, end, durationSec);
}

/** the beat grid position of each beat that falls inside [from, to] – for a display */
export function beatsBetween(from: number, to: number, info: BpmInfo, limit = 400): number[] {
  if (!(to > from) || info.anchor === undefined) return [];
  const len = beatSeconds(info.bpm);
  const first = Math.ceil((from - info.anchor) / len);
  const out: number[] = [];
  for (let k = first; out.length < limit; k++) {
    const t = info.anchor + k * len;
    if (t > to) break;
    out.push(t);
  }
  return out;
}

/* ------------------------------------------------------------------ matching tempos ------------------------------------------------------------------ */
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
/** beyond this change the sound suffers (and a mix gets obvious) – the screen says so */
export const FAR_FROM_ONE = 0.25;

export interface RateMatch {
  /** the playback speed that makes `currentBpm` play at `targetBpm` */
  rate: number;
  /** half / double: matched an octave away (70 BPM against 140 BPM is the same beat) */
  via: 'same' | 'half' | 'double';
  /** a big change: it will sound stretched */
  far: boolean;
}

/** The speed that brings a song to the tempo of the one it is mixed with – an octave away counts as the same beat. */
export function matchRate(currentBpm: number, targetBpm: number): RateMatch | null {
  if (!validBpm(currentBpm) || !validBpm(targetBpm)) return null;
  const ratio = targetBpm / currentBpm;
  const candidates: { rate: number; via: RateMatch['via'] }[] = [
    { rate: ratio, via: 'same' },
    { rate: ratio / 2, via: 'half' },
    { rate: ratio * 2, via: 'double' },
  ];
  const usable = candidates.filter((c) => c.rate >= MIN_RATE && c.rate <= MAX_RATE);
  if (!usable.length) return null;
  const best = usable.reduce((a, b) => (Math.abs(Math.log(b.rate)) < Math.abs(Math.log(a.rate)) ? b : a));
  const rate = Math.round(best.rate * 1000) / 1000;
  return { rate, via: best.via, far: Math.abs(rate - 1) > FAR_FROM_ONE };
}

/** the tempo you hear: the song's own BPM times the speed it plays at */
export const effectiveBpm = (bpm: number, rate: number): number => roundBpm(bpm * rate);
