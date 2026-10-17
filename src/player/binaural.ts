import { type Mix, computeMix } from '../core/binaural';
import { presetByKey } from '../core/binauralPresets';
import { useSettings } from '../state/settings';
import { headphonesNow } from './output';

const FOCUS = presetByKey('focus');

/** the plan for one 集中 sound now: the tone (or none) and how loud the environment sound is */
export function mixFor(center: number): Mix {
  const s = useSettings.getState();
  return computeMix({
    strength: s.focusToneLevel,
    noise: s.binauralNoise,
    headphones: headphonesNow(),
    speakerMode: s.binauralSpeakerMode,
    center,
    beat: FOCUS.beat,
  });
}

/** how loud the environment sound is for a 集中 sound right now (the share that the tone leaves it) */
export const ambientFactor = (): number => mixFor(FOCUS.center).ambient;
