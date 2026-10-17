import type { StrengthLevel } from './binaural';

/** a scene: the middle pitch, the beat, and the strength that suits it */
export interface BinauralPreset {
  key: 'sleep' | 'relax' | 'focus';
  label: string;
  center: number;
  beat: number;
  strength: StrengthLevel;
}

/** the scenes. Sleep: 1–5 Hz beat at 100–200 Hz. Relax: 5–10 Hz at 150–200 Hz. Focus: 15–20 Hz at 200–250 Hz. */
export const PRESETS: BinauralPreset[] = [
  { key: 'sleep', label: '睡眠', center: 150, beat: 3, strength: 'low' },
  { key: 'relax', label: 'リラックス', center: 175, beat: 7, strength: 'normal' },
  { key: 'focus', label: '集中', center: 200, beat: 20, strength: 'normal' },
];

export const presetByKey = (key: BinauralPreset['key']): BinauralPreset => PRESETS.find((p) => p.key === key) ?? PRESETS[2];
