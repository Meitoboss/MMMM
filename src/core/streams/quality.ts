import type { AppPlatform, AudioQuality } from '../config';
import { playableOn } from './util';

/**
 * Which of the audio streams a video offers to play – the one thing the "音質" setting changes.
 *  low:      32-64 kbps, extreme data saver
 *  medium:   96-128 kbps, balance
 *  standard: best AAC (≈128 kbps), plays everywhere. (If a video has no AAC: on Android the best of the rest.)
 *  high:     Android only – 160+ kbps. iPhone: same as standard, because AVPlayer can only play AAC.
 *  veryHigh: Android only – 192+ kbps, highest quality.
 * Premium's 256 kbps needs a login, which the app does not have.
 */
export interface Rated {
  bitrate: number;
  mimeType?: string;
}

/** bitrate thresholds for each quality level */
const QUALITY_BITRATES = {
  low: { min: 32_000, max: 64_000 },
  medium: { min: 96_000, max: 128_000 },
  standard: { min: 128_000, max: 160_000 },
  high: { min: 160_000, max: 192_000 },
  veryHigh: { min: 192_000, max: Infinity },
};

export const QUALITY_LABELS: Record<AudioQuality, string> = {
  low: '低（節約）',
  medium: '中',
  standard: '標準',
  high: '高音質',
  veryHigh: '最高音質'
};

/** the choices that make sense on this phone – high/veryHigh are Android-only */
export const qualitiesFor = (platform: AppPlatform): AudioQuality[] =>
  (platform === 'android' ? ['low', 'medium', 'standard', 'high', 'veryHigh'] : ['low', 'medium', 'standard']);

export const isAudioQuality = (v: unknown): v is AudioQuality =>
  v === 'low' || v === 'medium' || v === 'standard' || v === 'high' || v === 'veryHigh';

export function chooseByQuality<T extends Rated>(items: T[], quality: AudioQuality, platform: AppPlatform): T | undefined {
  // only what this phone's player can play
  const playable = items.filter((i) => playableOn(platform, i.mimeType) && Number.isFinite(i.bitrate));
  if (!playable.length) return undefined;
  const desc = (a: T, b: T) => b.bitrate - a.bitrate;
  const asc = (a: T, b: T) => a.bitrate - b.bitrate;
  const mp4 = playable.filter((i) => i.mimeType?.startsWith('audio/mp4'));

  const range = QUALITY_BITRATES[quality];
  const inRange = playable.filter((i) => i.bitrate >= range.min && i.bitrate <= range.max);

  if (quality === 'low') {
    // low: find lowest bitrate suitable for music
    return [...(inRange.length ? inRange : playable)].sort(asc)[0];
  }
  if (quality === 'medium') {
    // medium: find middle bitrate in range
    return [...(inRange.length ? inRange : playable)].sort(asc)[Math.floor(inRange.length / 2)] || [...playable].sort(asc)[0];
  }
  if (quality === 'standard') {
    // standard: AAC first (best for compatibility), else best in standard range
    const mp4InRange = mp4.filter((i) => i.bitrate >= range.min && i.bitrate <= range.max);
    return [...(mp4InRange.length ? mp4InRange : mp4.length ? mp4 : inRange.length ? inRange : playable)].sort(desc)[0];
  }
  if (quality === 'high' || quality === 'veryHigh') {
    // high/veryHigh: highest bitrate in range (Android only)
    if (platform === 'android') {
      return [...(inRange.length ? inRange : playable)].sort(desc)[0];
    }
    // On iPhone, fall back to standard
    return [...(mp4.length ? mp4 : playable)].sort(desc)[0];
  }
  return undefined;
}
