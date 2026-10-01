import type { LyricLine } from '../types';

/**
 * Port of `Lyrics.sentences` (LrcLib.kt / KuGou.kt).
 * The Kotlin version only understood `[mm:ss.xx]`; this one also accepts `[mm:ss]`, `[mm:ss.xxx]`
 * and several timestamps on one line.
 */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [{ time: 0, text: '' }];
  for (const raw of text.trim().split(/\r?\n/)) {
    const stamps: number[] = [];
    let rest = raw;
    for (;;) {
      const m = rest.match(/^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/);
      if (!m) break;
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      stamps.push(parseInt(m[1], 10) * 60_000 + parseInt(m[2], 10) * 1000 + frac);
      rest = rest.slice(m[0].length);
    }
    if (stamps.length === 0) continue;
    for (const time of stamps) lines.push({ time, text: rest.trim() });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Index of the line that should be highlighted at `positionMs`. */
export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function containsAt(line: string, needle: string, index: number): boolean {
  return line.startsWith(needle, index);
}

/** `KuGou.Lyrics.normalize()` – strips tag/credit header lines that KuGou adds. */
export function normalizeKuGou(value: string): string {
  let toDrop = 0;
  let maybeToDrop = 0;
  const text = value.replace(/\r\n/g, '\n').trim();

  for (const line of text.split('\n')) {
    if (
      line.startsWith('[ti:') ||
      line.startsWith('[ar:') ||
      line.startsWith('[al:') ||
      line.startsWith('[by:') ||
      line.startsWith('[hash:') ||
      line.startsWith('[sign:') ||
      line.startsWith('[qq:') ||
      line.startsWith('[total:') ||
      line.startsWith('[offset:') ||
      line.startsWith('[id:') ||
      containsAt(line, ']Written by：', 9) ||
      containsAt(line, ']Lyrics by：', 9) ||
      containsAt(line, ']Composed by：', 9) ||
      containsAt(line, ']Producer：', 9) ||
      containsAt(line, ']作曲 : ', 9) ||
      containsAt(line, ']作词 : ', 9)
    ) {
      toDrop += line.length + 1 + maybeToDrop;
      maybeToDrop = 0;
    } else if (maybeToDrop === 0) {
      maybeToDrop = line.length + 1;
    } else {
      maybeToDrop = 0;
      break;
    }
  }
  return text.slice(toDrop + maybeToDrop).replace(/&apos;/g, "'");
}
