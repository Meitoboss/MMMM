import type { AppPlatform, AudioQuality } from '../config';
import { playableOn } from './util';

/**
 * Which of the audio streams a video offers to play – the one thing the "音質" setting changes.
 *  standard: the best AAC (≈128 kbps), plays everywhere. (If a video has no AAC: on Android the best of the rest.)
 *  saver:    the lowest bitrate that is still music (≥ 32 kbps) – about a third of the data.
 *  high:     Android only – the highest bitrate whatever the codec (Opus is often ≈160 kbps). iPhone: same as standard,
 *            because AVPlayer can only play AAC.
 * Premium's 256 kbps needs a login, which the app does not have.
 */
export interface Rated {
  bitrate: number;
  mimeType?: string;
}

/** a "saver" stream below this is not worth it (and some are broken) */
export const MIN_SAVER_BITRATE = 32_000;

export const QUALITY_LABELS: Record<AudioQuality, string> = { standard: '標準', saver: '節約', high: '高音質' };

/** the choices that make sense on this phone – "high" is the same as "standard" on an iPhone, so it is not offered */
export const qualitiesFor = (platform: AppPlatform): AudioQuality[] => (platform === 'android' ? ['standard', 'saver', 'high'] : ['standard', 'saver']);

export const isAudioQuality = (v: unknown): v is AudioQuality => v === 'standard' || v === 'saver' || v === 'high';

export function chooseByQuality<T extends Rated>(items: T[], quality: AudioQuality, platform: AppPlatform): T | undefined {
  // only what this phone's player can play
  const playable = items.filter((i) => playableOn(platform, i.mimeType) && Number.isFinite(i.bitrate));
  if (!playable.length) return undefined;
  const desc = (a: T, b: T) => b.bitrate - a.bitrate;
  const asc = (a: T, b: T) => a.bitrate - b.bitrate;
  const mp4 = playable.filter((i) => i.mimeType?.startsWith('audio/mp4'));

  if (quality === 'saver') {
    const usable = playable.filter((i) => i.bitrate >= MIN_SAVER_BITRATE);
    return [...(usable.length ? usable : playable)].sort(asc)[0];
  }
  if (quality === 'high' && platform === 'android') return [...playable].sort(desc)[0];
  // standard (and "high" on an iPhone): AAC first, else the best of what is left
  return [...(mp4.length ? mp4 : playable)].sort(desc)[0];
}
