/**
 * The 集中 sounds on the server (/audio/<name>.flac). Pure logic, so it can be tested.
 * The list is written here for now; later it can come from the server's list of sounds.
 */
export const FOCUS_SOUNDS = [
  'focus_loop',
  'relax_loop',
  'meditate_loop',
  'sleep_loop',
  'anxiety_loop',
  'spiritual_loop',
  'n011_wind_1',
  'so_852hz',
  'onboarding',
  'onboarding_trs_281',
  'sleep_06',
  'sleep_06_trs_223',
];

/** the file name of one sound, both on the server and on the phone */
export const focusFileName = (key: string): string => `${key}.flac`;

/** the address that gives out a signed address for one sound (valid for one hour) */
export function focusIssueUrl(serverUrl: string, key: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/issue?path=${encodeURIComponent(`/audio/${focusFileName(key)}`)}&ttl=3600`;
}
