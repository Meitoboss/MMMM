import { Alert } from 'react-native';

import { native } from '../../modules/binaural-tone';
import { refreshAmbient } from '../state/player';
import { mixFor } from './binaural';
import { focusKeyOf, soundPitch } from './focus';
import { onHeadphonesChange } from './output';

/**
 * The binaural tone beside a 集中 sound. It is made on the phone (modules/binaural-tone), so it has no end.
 * The plan (strength, noise, headphones or speakers) comes from core/binaural.ts.
 */

/** the 集中 sound that is playing now, by its key (null when no 集中 sound plays) */
let focusWant: { key: string } | null = null;
/** the tone on its own, for trying it out in Settings (null when off) */
let testWant: { center: number; beat: number } | null = null;
/** the pitch the test uses: the middle pitch of the 集中 sound and the difference between the ears */
let testPitch = { center: 180, beat: 20 };
let playing = false;

/** brings the tone in line with the plan: starts, changes or stops it, and sets the environment sound to match */
function apply(): void {
  if (!native) return;
  // the test and the 集中 sounds play the tone whatever the output is (headphones or not): detection is not needed to hear it
  // each 集中 sound has its own pitch (the focus sound's comes from the settings, which the 気分 tab changes)
  const pitch = focusWant ? focusEars(focusWant.key) : null;
  const tone = testWant ? mixFor(testWant.center, true, testWant.beat).tone : pitch ? mixFor(pitch.center, true, pitch.beat).tone : null;
  if (!tone) {
    if (playing) native.stop();
    playing = false;
  } else if (playing) {
    native.update(tone.center, tone.beat, tone.toneVolume, tone.noiseVolume);
  } else {
    try {
      native.start(tone.center, tone.beat, tone.toneVolume, tone.noiseVolume);
      playing = true;
    } catch (e) {
      // the reason is shown, so a tone that does not sound on a phone can be traced
      Alert.alert('正弦波', `鳴らせませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  refreshAmbient();
}

/** beta only: how far each ear is moved by hand, in Hz, on top of the 集中 sound's own pitch */
let earShift = { left: 0, right: 0 };

/** the pitch of the 集中 sound with the hand-made shift: the middle pitch and the difference between the ears */
function focusEars(key: string): { center: number; beat: number } {
  const own = soundPitch(key);
  return {
    center: own.center + (earShift.left + earShift.right) / 2,
    beat: own.beat + (earShift.right - earShift.left),
  };
}

/** the left and right ear's pitch of a 集中 sound, in Hz */
export function earsOf(key: string): { left: number; right: number } {
  const { center, beat } = focusEars(key);
  return { left: center - beat / 2, right: center + beat / 2 };
}

/** beta only: moves one ear of the 集中 sounds by `delta` Hz, now (a playing sound follows at once) */
export function shiftEar(side: 'left' | 'right', delta: number): void {
  earShift = { ...earShift, [side]: earShift[side] + delta };
  apply();
}

/** a 集中 sound is playing: its tone plays beside it */
export function playTone(songId: string): Promise<void> {
  focusWant = { key: focusKeyOf(songId) };
  apply();
  return Promise.resolve();
}

/** the 集中 sound stopped or paused: the tone fades out */
export function pauseTone(): void {
  focusWant = null;
  apply();
}

/** the settings (strength, noise, speakers) changed: apply them now */
export function refreshTone(): void {
  apply();
}

/** the tone alone, without any music: starts it at `center` Hz, or stops it. Returns whether it is on now. */
export function toggleToneTest(): boolean {
  testWant = testWant ? null : { ...testPitch };
  apply();
  return testWant !== null;
}

export const toneTesting = (): boolean => testWant !== null;

/** the left and right ear's pitch of the test, in Hz */
export const testEars = (): { left: number; right: number } => ({
  left: testPitch.center - testPitch.beat / 2,
  right: testPitch.center + testPitch.beat / 2,
});

/** sets the left and right ear's pitch for the test (a playing test follows at once) */
export function setTestEars(left: number, right: number): void {
  testPitch = { center: (left + right) / 2, beat: right - left };
  if (testWant) testWant = { ...testPitch };
  apply();
}

// headphones plugged in or out: the tone fades out (speakers, stop) or changes its pitch (speakers, shift)
onHeadphonesChange(() => apply());

/** whether this build of the app has the tone (a build from before the native code does not) */
export const toneAvailable = (): boolean => native !== null;
