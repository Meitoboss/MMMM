import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { LOCAL_ARTIST, LOCAL_PREFIX } from '../core/localMeta';
import { focusFileName, focusHzOf, focusIssueUrl, FOCUS_SOUNDS, type FocusGroup } from '../core/focus';
import type { AudioSource, SongItem } from '../core/types';
import { useSettings } from '../state/settings';

/**
 * The 集中 (focus) sounds come from the server. The first time one is used it is downloaded (with a signed address
 * from the server) and kept on the phone; after that it plays from the phone. The sine tone is not in these files:
 * it is played beside them (player/tone.ts).
 * They are played as local songs, so the player, the queue and the lists handle them like the files on the phone.
 */
const FOCUS_PREFIX = `${LOCAL_PREFIX}focus-`;

export const isFocusId = (id: string): boolean => id.startsWith(FOCUS_PREFIX);

/** the key of a focus song, from its id (empty when it is not a focus song) */
export const focusKeyOf = (id: string): string => (isFocusId(id) ? id.slice(FOCUS_PREFIX.length) : '');

/** the id of a focus sound, from its key */
export const focusIdOf = (key: string): string => `${FOCUS_PREFIX}${key}`;

/** the two ears of a sound's tone: the middle and the beat of its list entry (fixed: 広い野原 170:190, 残る月光 200:200.5) */
export function soundPitch(key: string): { center: number; beat: number } {
  const sound = FOCUS_SOUNDS.find((x) => x.key === key);
  return { center: sound?.hz ?? 200, beat: sound?.beat ?? 20 };
}

const folder = (): string => `${FileSystem.documentDirectory ?? ''}focus/`;

/** one focus sound as a song */
export function focusSongOf(key: string): SongItem {
  const { name } = FOCUS_SOUNDS.find((x) => x.key === key) ?? { name: key };
  return { kind: 'song', id: `${FOCUS_PREFIX}${key}`, title: name, artists: [{ name: LOCAL_ARTIST }], explicit: false };
}

/** the ready focus sounds of one card, as songs, in the order they are listed */
export function focusSongs(group: FocusGroup = 'focus'): SongItem[] {
  return FOCUS_SOUNDS.filter((x) => x.group === group && x.ready).map(({ key, name }) => ({
    kind: 'song',
    id: `${FOCUS_PREFIX}${key}`,
    title: name,
    artists: [{ name: LOCAL_ARTIST }],
    explicit: false,
  }));
}

/** where the player can read one focus sound from: the phone's copy, downloaded first if it is not there yet */
export async function resolveFocus(songId: string): Promise<AudioSource> {
  const key = songId.slice(FOCUS_PREFIX.length);
  if (!FOCUS_SOUNDS.some((s) => s.key === key)) throw new Error('集中の音が見つかりません');
  const local = `${folder()}${focusFileName(key)}`;
  const info = await FileSystem.getInfoAsync(local);
  if (!info.exists) await download(key, local);
  return { url: local, via: 'local', note: 'focus sound' };
}

/** saves one sound: the address is asked for first (signed, one hour), the file comes in as "name.part", then it is renamed */
async function download(key: string, local: string): Promise<void> {
  const { focusServerUrl, focusServerKey } = useSettings.getState();
  if (!focusServerKey.trim()) throw new Error('設定で、集中の音のサーバーのキーを入れてください');
  await FileSystem.makeDirectoryAsync(folder(), { intermediates: true }).catch(() => undefined);

  const issued = await fetch(focusIssueUrl(focusServerUrl, key), { headers: { 'X-Api-Key': focusServerKey.trim() } });
  if (!issued.ok) throw new Error(`集中の音の取得に失敗しました（${issued.status}）`);
  const { url } = (await issued.json()) as { url: string };

  const part = `${local}.part`;
  // on iPhone the download runs inside the app (foreground), like the saves for offline use: the system's background transfer
  // can fail with "Cannot create file" when the app's signature is changed by the signing tool
  const options: FileSystem.DownloadOptions = Platform.OS === 'ios' ? { sessionType: FileSystem.FileSystemSessionType.FOREGROUND } : {};
  const res = await FileSystem.createDownloadResumable(`${focusServerUrl}${url}`, part, options).downloadAsync();
  if (!res || (res.status !== 200 && res.status !== 206)) {
    await FileSystem.deleteAsync(part, { idempotent: true });
    throw new Error(`集中の音をダウンロードできませんでした（${res?.status ?? '—'}）`);
  }
  await FileSystem.moveAsync({ from: part, to: local });
}
