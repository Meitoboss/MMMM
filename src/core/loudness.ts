/**
 * Volume normalisation. YouTube reports, per video, how much louder than its reference level it is (`loudnessDb`):
 * +6 means "6 dB too loud", a negative value means "quieter than the reference". The official player turns loud videos down.
 * A phone player cannot make a track louder than 100 %, so only loud tracks are turned down – quiet ones stay as they are.
 */
export type NormalizeMode = 'off' | 'light' | 'standard';

export const NORMALIZE_MODES: NormalizeMode[] = ['off', 'light', 'standard'];

export function normalizedVolume(loudnessDb: number | null | undefined, mode: NormalizeMode): number {
  if (mode === 'off' || loudnessDb === undefined || loudnessDb === null || !Number.isFinite(loudnessDb)) return 1;
  if (Math.abs(loudnessDb) > 30) return 1; // not a believable value: leave the volume alone
  const strength = mode === 'light' ? 0.5 : 1;
  const gainDb = -Math.max(0, loudnessDb) * strength;
  return Math.max(0.1, Math.min(1, 10 ** (gainDb / 20)));
}

export function isNormalizeMode(v: unknown): v is NormalizeMode {
  return v === 'off' || v === 'light' || v === 'standard';
}
