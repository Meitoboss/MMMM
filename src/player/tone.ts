import { native } from '../../modules/binaural-tone';
import { type ToneLevel, toneVolume } from '../core/focus';

/**
 * The sine tone beside a 集中 sound. It is made live on the phone (modules/binaural-tone), so it has no end.
 * `beatHz` is 0: the same tone in both ears, as before.
 */
const BEAT_HZ = 0;

/** plays the tone at `requested` Hz; a new frequency or loudness takes effect at once */
export function playTone(requested: number, level: ToneLevel): Promise<void> {
  const volume = toneVolume(level);
  if (!native) return Promise.resolve();
  if (volume === 0) {
    native.stop();
    return Promise.resolve();
  }
  native.start(requested, BEAT_HZ, volume);
  return Promise.resolve();
}

export function pauseTone(): void {
  native?.stop();
}
