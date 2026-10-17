import { native } from '../../modules/binaural-tone';
import { refreshAmbient } from '../state/player';
import { mixFor } from './binaural';
import { onHeadphonesChange } from './output';

/**
 * The binaural tone beside a 集中 sound. It is made on the phone (modules/binaural-tone), so it has no end.
 * The plan (strength, noise, headphones or speakers) comes from core/binaural.ts.
 */

/** the 集中 sound that is playing now, by its middle pitch (null when no 集中 sound plays) */
let want: { center: number } | null = null;
let playing = false;

/** brings the tone in line with the plan: starts, changes or stops it, and sets the environment sound to match */
function apply(): void {
  if (!native) return;
  const mix = want ? mixFor(want.center) : null;
  const tone = mix?.tone ?? null;
  if (!tone) {
    if (playing) native.stop();
    playing = false;
  } else if (playing) {
    native.update(tone.center, tone.beat, tone.toneVolume, tone.noiseVolume);
  } else {
    native.start(tone.center, tone.beat, tone.toneVolume, tone.noiseVolume);
    playing = true;
  }
  refreshAmbient();
}

/** a 集中 sound at `center` Hz is playing: the tone plays beside it */
export function playTone(center: number): Promise<void> {
  want = { center };
  apply();
  return Promise.resolve();
}

/** the 集中 sound stopped or paused: the tone fades out */
export function pauseTone(): void {
  want = null;
  apply();
}

/** the settings (strength, noise, speakers) changed: apply them now */
export function refreshTone(): void {
  apply();
}

// headphones plugged in or out: the tone fades out (speakers, stop) or changes its pitch (speakers, shift)
onHeadphonesChange(() => apply());
