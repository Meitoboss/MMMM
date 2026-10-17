/**
 * The binaural tone of the 集中 mode: how loud it is, and where it goes (headphones or speakers).
 * Pure, so it can be tested. The environment sound (the music file) is not made quieter by the tone:
 * the tone sits on top of it, at the level of ANIMA's Normal (about 0.6).
 */

/** how strong the binaural tone is (the user's setting): the amplitude of the sine in each ear */
export type StrengthLevel = 'off' | 'low' | 'normal' | 'high';
export const STRENGTH: Record<StrengthLevel, number> = { off: 0, low: 0.3, normal: 0.6, high: 0.8 };

/** how much pink noise is mixed under the tone (relative to the tone) */
export type NoiseLevel = 'off' | 'low' | 'high';
export const NOISE_MIX: Record<NoiseLevel, number> = { off: 0, low: 0.3, high: 0.6 };

/** what happens with the tone on speakers: stop it, or play it with the pitch raised */
export type SpeakerMode = 'stop' | 'shift';
export const SPEAKER_SHIFT_HZ = 100;

/** a beat wider than this sounds like two notes, not like a beat */
export const MAX_BEAT_HZ = 30;

export const clampBeat = (beat: number): number => Math.min(MAX_BEAT_HZ, Math.max(0, beat));

export interface MixInput {
  strength: StrengthLevel;
  noise: NoiseLevel;
  headphones: boolean;
  speakerMode: SpeakerMode;
  /** the middle pitch of the tone, in Hz */
  center: number;
  /** the difference between the ears, in Hz (the beat) */
  beat: number;
}

export interface ToneMix {
  center: number;
  beat: number;
  toneVolume: number;
  noiseVolume: number;
}

export interface Mix {
  /** how loud the environment sound is: always 1, the tone does not take from it */
  ambient: number;
  /** the tone to play, or null when it is silent */
  tone: ToneMix | null;
}

/** the whole plan: the tone (or none) for the output that is used now */
export function computeMix(input: MixInput): Mix {
  const strength = STRENGTH[input.strength];
  const shift = !input.headphones && input.speakerMode === 'shift';
  const on = strength > 0 && (input.headphones || shift);
  if (!on) return { ambient: 1, tone: null };

  return {
    ambient: 1,
    tone: {
      center: shift ? input.center + SPEAKER_SHIFT_HZ : input.center,
      beat: clampBeat(input.beat),
      toneVolume: strength,
      noiseVolume: strength * NOISE_MIX[input.noise],
    },
  };
}
