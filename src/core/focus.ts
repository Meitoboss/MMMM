import { STRENGTH, type StrengthLevel } from './binaural';
import type { TuningKey } from './tuning';

/**
 * The 集中 sounds on the server (/audio/<name>.flac), and the sine tone that plays under each one.
 * Pure logic, so it can be tested.
 *
 * - The height (Hz) of the tone is fixed per sound (edit `hz` below). The person cannot change it in the app.
 * - The person chooses only the loudness of the tone (なし / 低 / 普通 / 高), in Settings.
 */
export interface FocusSound {
  /** the name of the sound on the server (without .flac) */
  key: string;
  /** the name shown in the app */
  name: string;
  /** the middle of the two ears of the sine tone, in Hz (the focus sound uses the setting instead) */
  hz: number;
  /** the difference between the ears, in Hz: the beat */
  beat: number;
  /** the card it is shown under on the 気分 tab */
  group: FocusGroup;
  /** false while the sound is not on the server yet: it is shown, but cannot be played */
  ready: boolean;
  /** the シナリオ (the chips on the 気分 tab) this sound belongs to */
  scenarios: string[];
  /** the 脳をチューニング card it is shown under (null: none) */
  tuning: TuningKey | null;
  /** the heading of its group on that card's page (see SECTION_TEXT in core/tuning.ts) */
  section: string;
}

/** the big sections of the 気分 tab the sounds are shown under */
/** 'none': not under a heading on the 気分 tab (the sound is only found through its scenario) */
export type FocusGroup = 'focus' | 'sleep' | 'nature' | 'none';

/**
 * The sounds on the server. Add a line here for each new sound (the file must be /var/oled/audio/<key>.flac on the server).
 */
export const FOCUS_SOUNDS: FocusSound[] = [
  { key: 'focus_loop', name: '広い野原', hz: 180, beat: 20, group: 'focus', ready: true, scenarios: ['ディープワーク'], tuning: 'focus', section: '仕事・勉強' },
  // the height (hz) is not set yet: it is a placeholder until the height is decided; the sound is not on the server yet (準備中)
  { key: 'sunset_flow', name: 'サンセットフロー', hz: 200, beat: 16, group: 'focus', ready: false, scenarios: ['ディープワーク'], tuning: 'focus', section: '仕事・勉強' },
  { key: 'moon_light', name: '残る月光', hz: 200.25, beat: 0.5, group: 'sleep', ready: true, scenarios: ['深い眠り'], tuning: 'sleep', section: '深い眠り' },
  { key: 'rain', name: 'ブリキ屋根の夢想', hz: 102.5, beat: 5, group: 'nature', ready: true, scenarios: [], tuning: 'relax', section: 'おすすめ' },
  { key: 'light', name: '光と踊る', hz: 528, beat: 8, group: 'none', ready: true, scenarios: ['528hz リラックス'], tuning: 'relax', section: 'おすすめ' },
];

/** how strong the binaural tone is: none, low, normal, high (see core/binaural.ts) */
export type ToneLevel = StrengthLevel;

export const TONE_LEVELS: { value: ToneLevel; label: string; volume: number }[] = [
  { value: 'off', label: 'オフ', volume: STRENGTH.off },
  { value: 'low', label: "低", volume: STRENGTH.low },
  { value: 'normal', label: "普通", volume: STRENGTH.normal },
  { value: 'high', label: "高", volume: STRENGTH.high },
];

export const toneVolume = (level: ToneLevel): number => STRENGTH[level];

/** the height of the tone for one sound (undefined when the sound is not in the list) */
export const focusHzOf = (key: string): number | undefined => FOCUS_SOUNDS.find((s) => s.key === key)?.hz;

/** the file name of one sound, both on the server and on the phone */
export const focusFileName = (key: string): string => `${key}.flac`;

/** the address that gives out a signed address for one sound (valid for one hour) */
export function focusIssueUrl(serverUrl: string, key: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/issue?path=${encodeURIComponent(`/audio/${focusFileName(key)}`)}&ttl=3600`;
}
