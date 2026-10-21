/**
 * The 脳をチューニング cards on the 気分 tab: each one is a kind of sound (sleep, relax, ...).
 * Pure data, so it can be tested. The sounds say which one they belong to (`tuning` in core/focus.ts).
 */
export type TuningKey = 'sleep' | 'relax' | 'focus' | 'meditate' | 'tinnitus';

export interface Tuning {
  key: TuningKey;
  /** the name on the card and on its page */
  title: string;
  /** an Ionicons name (the screens cast it) */
  icon: string;
  /** the colour of the card and of the page's header */
  color: string;
  /** the line under the 「おすすめ」 heading of its page */
  description: string;
}

export const TUNINGS: Tuning[] = [
  { key: 'sleep', title: '睡眠', icon: 'moon-outline', color: '#2a3b66', description: '0.5〜7Hzの波がアンビエントメロディーを通じて流れ、眠る前の日常の緊張を解放します。' },
  { key: 'relax', title: 'リラックス', icon: 'sparkles-outline', color: '#4d6e44', description: '体と心を緩め、穏やかな気づきへ導くサウンドです。' },
  { key: 'focus', title: '集中', icon: 'ellipse-outline', color: '#5a4595', description: 'アルファ/ベータ波（8-30Hz）がタスクへの注意力を高めます。' },
  { key: 'meditate', title: '瞑想', icon: 'person-outline', color: '#3f7a74', description: '内側へ意識を向け、静かな時間を過ごすためのサウンドです。' },
  { key: 'tinnitus', title: '耳鳴り緩和', icon: 'ear-outline', color: '#3d6d92', description: '耳鳴りが気になるときに、やわらかい音で気をそらすサウンドです。' },
];

export const tuningOf = (key: TuningKey): Tuning | undefined => TUNINGS.find((t) => t.key === key);
