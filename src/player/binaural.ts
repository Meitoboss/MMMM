import { type Mix, computeMix } from '../core/binaural';
import { presetByKey } from '../core/binauralPresets';
import { useSettings } from '../state/settings';
import { headphonesNow } from './output';

const FOCUS = presetByKey('focus');

/**
 * the plan for one tone now: the tone (or none) and how loud the environment sound is.
 * `headphones` says whether the output is headphones; the 集中 sounds and the test pass true, so the tone plays on speakers too.
 */
export function mixFor(center: number, headphones: boolean = headphonesNow(), beat: number = FOCUS.beat): Mix {
  const s = useSettings.getState();
  return computeMix({
    strength: s.focusToneLevel,
    noise: s.binauralNoise,
    headphones,
    speakerMode: s.binauralSpeakerMode,
    center,
    beat,
  });
}

/** how loud the environment sound is for a 集中 sound right now (the share that the tone leaves it) */
export const ambientFactor = (): number => mixFor(FOCUS.center).ambient;
