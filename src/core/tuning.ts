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
}

export const TUNINGS: Tuning[] = [
  { key: 'sleep', title: '睡眠', icon: 'moon-outline', color: '#2a3b66' },
  { key: 'relax', title: 'リラックス', icon: 'sparkles-outline', color: '#4d6e44' },
  { key: 'focus', title: '集中', icon: 'ellipse-outline', color: '#5a4595' },
  { key: 'meditate', title: '瞑想', icon: 'person-outline', color: '#3f7a74' },
  { key: 'tinnitus', title: '耳鳴り緩和', icon: 'ear-outline', color: '#3d6d92' },
];

/** the line under the heading of each group on a 脳をチューニング page */
export const SECTION_TEXT: Record<string, string> = {
  おすすめ: 'いまおすすめの、落ち着いたサウンドです。',
  '仕事・勉強': 'アルファ/ベータ波（8-30Hz）がタスクへの注意力を高めます。',
  深い眠り: '0.5-7Hzの波がアンビエントメロディーを通じて流れ、眠る前の日常の緊張を解放します。',
  夜のリセット: '0.5-7Hzの波がアンビエントメロディーを通じて流れ、眠る前の日常の緊張を解放します。',
};

export const tuningOf = (key: TuningKey): Tuning | undefined => TUNINGS.find((t) => t.key === key);
