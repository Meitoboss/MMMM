import { computeMix, type Mix } from '../core/binaural';
import { presetByKey } from '../core/binauralPresets';
import { useSettings } from '../state/settings';
import { headphonesNow } from './output';

const FOCUS = presetByKey('focus');

/**
 * the plan for one 集中 sound now: the tone (or none) and how loud the environment sound is.
 * `headphones` says whether the output is headphones; the tone test passes true, so it plays even when the output is not detected.
 */
export function mixFor(center: number, headphones: boolean = headphonesNow()): Mix {
  const s = useSettings.getState();
  return computeMix({
    strength: s.focusToneLevel,
    noise: s.binauralNoise,
    headphones,
    speakerMode: s.binauralSpeakerMode,
    center,
    beat: FOCUS.beat,
  });
}

/** how loud the environment sound is for a 集中 sound right now (the share that the tone leaves it) */
export const ambientFactor = (): number => mixFor(FOCUS.center).ambient;
