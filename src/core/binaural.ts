/**
 * The volume plan for the 集中 mode: the environment sound (the music file) and the binaural tone share the loudness.
 * Pure, so it can be tested. The numbers follow the design for the binaural tone.
 */

/** share of the environment sound, and of the binaural tone (their sum must stay at 1 or below) */
export const AMBIENT_COEF = 0.7;
export const BINAURAL_COEF = 0.3;

/** how strong the binaural tone is (the user's setting) */
export type StrengthLevel = 'off' | 'low' | 'normal' | 'high';
export const STRENGTH: Record<StrengthLevel, number> = { off: 0, low: 0.3, normal: 0.5, high: 0.7 };

/** how much pink noise is mixed under the tone (relative to the tone) */
export type NoiseLevel = 'off' | 'low' | 'high';
export const NOISE_MIX: Record<NoiseLevel, number> = { off: 0, low: 0.3, high: 0.6 };

/** what happens with the tone on speakers: stop it, or play it with the pitch raised */
export type SpeakerMode = 'stop' | 'shift';
export const SPEAKER_SHIFT_HZ = 100;

/** a beat wider than this sounds like two notes, not like a beat */
export const MAX_BEAT_HZ = 30;

/** makes the two shares fit: when they add up to more than 1, both are scaled down by the same factor */
export function normalizeCoefs(ambient: number, binaural: number): { ambient: number; binaural: number } {
  const sum = ambient + binaural;
  return sum <= 1 ? { ambient, binaural } : { ambient: ambient / sum, binaural: binaural / sum };
}

const COEFS = normalizeCoefs(AMBIENT_COEF, BINAURAL_COEF);

/** a slider value (0 to 1) becomes the volume that is used: squared, so the low end is finer */
export const sliderToVolume = (value: number): number => {
  const v = Math.min(1, Math.max(0, value));
  return v * v;
};

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
  /** the volume share of the environment sound (1 when the tone is off, so the sound is not made quieter for nothing) */
  ambient: number;
  /** the tone to play, or null when it is silent */
  tone: ToneMix | null;
}

/** the whole plan: how loud the environment sound is, and what the tone is (or that it is off) */
export function computeMix(input: MixInput): Mix {
  const strength = STRENGTH[input.strength];
  const shift = !input.headphones && input.speakerMode === 'shift';
  const on = strength > 0 && (input.headphones || shift);
  if (!on) return { ambient: 1, tone: null };

  const toneVolume = strength * COEFS.binaural;
  return {
    ambient: COEFS.ambient,
    tone: {
      center: shift ? input.center + SPEAKER_SHIFT_HZ : input.center,
      beat: clampBeat(input.beat),
      toneVolume,
      noiseVolume: toneVolume * NOISE_MIX[input.noise],
    },
  };
}
