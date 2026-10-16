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
  /** the height of the sine tone under this sound, in Hz */
  hz: number;
}

/**
 * The sounds on the server. Add a line here for each new sound (the file must be /var/oled/audio/<key>.flac on the server).
 */
export const FOCUS_SOUNDS: FocusSound[] = [{ key: 'focus_loop', name: '広い野原', hz: 20 }];

/** how loud the sine tone is: none, low, normal, high */
export type ToneLevel = 'off' | 'low' | 'normal' | 'high';

export const TONE_LEVELS: { value: ToneLevel; label: string; volume: number }[] = [
  { value: 'off', label: 'なし', volume: 0 },
  { value: 'low', label: '低', volume: 0.12 },
  { value: 'normal', label: '普通', volume: 0.25 },
  { value: 'high', label: '高', volume: 0.5 },
];

export const toneVolume = (level: ToneLevel): number => TONE_LEVELS.find((l) => l.value === level)?.volume ?? 0;

/** the height of the tone for one sound (undefined when the sound is not in the list) */
export const focusHzOf = (key: string): number | undefined => FOCUS_SOUNDS.find((s) => s.key === key)?.hz;

/** the file name of one sound, both on the server and on the phone */
export const focusFileName = (key: string): string => `${key}.flac`;

/** the address that gives out a signed address for one sound (valid for one hour) */
export function focusIssueUrl(serverUrl: string, key: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/issue?path=${encodeURIComponent(`/audio/${focusFileName(key)}`)}&ttl=3600`;
}
