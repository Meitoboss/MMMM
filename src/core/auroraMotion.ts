/**
 * The aurora under the cover: how it moves. Pure data and rules (no React Native), so the "calm when paused, beating when
 * playing" behaviour can be tested. The ribbons are the three paths of the original design, drawn once as pictures
 * (assets/aurora-*.png) – the app only moves, stretches and brightens them.
 */
export type AuroraKey = 'red' | 'purple' | 'green';

export interface AuroraLayer {
  key: AuroraKey;
  /** seconds of one drift when calm (the original design: 38 / 30 / 22 s) */
  calmMs: number;
  /** brightness when paused */
  baseOpacity: number;
  /** where the ribbon lies up (−) or down (+), as a share of the height – so that, behind the cover, one peeks out above it and another below */
  offsetY: number;
  /** extra height of the ribbon at the peak of a beat (0.2 = 20 % taller) */
  beatScale: number;
  /** starts at the far end, like CSS "alternate-reverse" */
  reverse: boolean;
}

/**
 * ONE number to make the whole aurora stronger or paler (1 = as set). The original design measured about half of this
 * at the size it has under the cover and looked pale.
 */
export const AURORA_STRENGTH = 1;

/** bottom to top, as in the original: red, purple, green */
export const LAYERS: AuroraLayer[] = [
  { key: 'red', calmMs: 38000, baseOpacity: 0.6, offsetY: 0.1, beatScale: 0.1, reverse: false },
  { key: 'purple', calmMs: 30000, baseOpacity: 0.68, offsetY: 0.26, beatScale: 0.16, reverse: true },
  { key: 'green', calmMs: 22000, baseOpacity: 0.74, offsetY: -0.2, beatScale: 0.22, reverse: false },
];

/** on a light background the same colours are much stronger: they are taken down a little */
export const LIGHT_STRENGTH = 0.7;

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** brightness of a layer: `beat` 0 = rest, 1 = peak of a beat; `scale` 1 on a dark background, LIGHT_STRENGTH on a light one */
export const layerOpacity = (l: AuroraLayer, beat = 0, scale = 1): number =>
  clamp01(l.baseOpacity * AURORA_STRENGTH * scale * (1 + 0.55 * clamp01(beat)));

/** the original "auroraWav" keyframes (translation as a share of the picture's width / height) */
export const DRIFT = {
  input: [0, 0.33, 0.66, 1],
  x: [0, -0.15, -0.25, -0.4],
  y: [-0.05, 0.05, -0.08, 0.02],
  scale: [1, 1.1, 0.9, 1.05],
  rotateDeg: [0, 2, -2, 1],
};

/** while playing, the aurora drifts this many times faster */
export const PLAY_SPEEDUP = 3.2;
export const BEAT_BPM = 120;
/** strength of four beats in a row: a firm first beat, soft in between */
export const BEAT_PATTERN = [1, 0.55, 0.8, 0.55];

export interface AuroraMotion {
  /** one drift (one way) per layer */
  driftMs: number[];
  /** null = no beat (calm) */
  beat: null | { periodMs: number; attackMs: number; releaseMs: number; pattern: number[] };
}

export function auroraMotion(opts: { playing: boolean; rate?: number; reduceMotion?: boolean }): AuroraMotion {
  const { playing, rate = 1, reduceMotion = false } = opts;
  const driftMs = LAYERS.map((l) => Math.round(l.calmMs / (playing ? PLAY_SPEEDUP : 1)));
  if (!playing || reduceMotion) return { driftMs, beat: null };
  const r = Math.max(0.5, Math.min(2, Number.isFinite(rate) ? rate : 1));
  const periodMs = Math.round(60000 / (BEAT_BPM * r)); // the beat follows the playback speed
  const attackMs = Math.round(Math.max(40, Math.min(140, periodMs * 0.18)));
  return { driftMs, beat: { periodMs, attackMs, releaseMs: periodMs - attackMs, pattern: BEAT_PATTERN } };
}

/** below this height the aurora is not drawn (no room for a ribbon) */
export const MIN_AURORA_HEIGHT = 56;

/** how far the edges dissolve into the background: top / bottom as a share of the height, left / right of the width */
export const FADE_VERTICAL = 0.22;
export const FADE_HORIZONTAL = 0.12;
