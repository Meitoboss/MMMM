/**
 * The geometry of the app's own seek bar (used on Android, where the native slider did not react to touches).
 * The thumb is `thumb` wide and stays inside the bar: its CENTRE runs from thumb/2 to width - thumb/2. A finger at x is the thumb's centre.
 */
export const THUMB = 18;

export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** where a finger at `x` (from the bar's left edge; it may be outside the bar) puts the thumb: 0 … 1 */
export function fractionAt(x: number, width: number, thumb = THUMB): number {
  return width > thumb ? clamp01((x - thumb / 2) / (width - thumb)) : 0;
}

/** the position in the song that a finger at `x` means (seconds) */
export function valueAtX(x: number, width: number, max: number, thumb = THUMB): number {
  return fractionAt(x, width, thumb) * Math.max(0, max);
}

/** the left edge of the thumb for a value */
export function thumbLeft(value: number, max: number, width: number, thumb = THUMB): number {
  return (max > 0 ? clamp01(value / max) : 0) * Math.max(0, width - thumb);
}

/** how wide the coloured part (left of the thumb's centre) is */
export const fillWidth = (value: number, max: number, width: number, thumb = THUMB): number => (width > 0 ? thumbLeft(value, max, width, thumb) + thumb / 2 : 0);
