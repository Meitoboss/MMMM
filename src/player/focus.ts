import * as FileSystem from 'expo-file-system/legacy';

import { LOCAL_ARTIST, LOCAL_PREFIX } from '../core/localMeta';
import { focusFileName, focusIssueUrl, FOCUS_SOUNDS } from '../core/focus';
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

const folder = (): string => `${FileSystem.documentDirectory ?? ''}focus/`;

/** the focus sounds as songs, in the order they are listed */
export function focusSongs(): SongItem[] {
  return FOCUS_SOUNDS.map((key) => ({
    kind: 'song',
    id: `${FOCUS_PREFIX}${key}`,
    title: key,
    artists: [{ name: LOCAL_ARTIST }],
    explicit: false,
  }));
}

/** where the player can read one focus sound from: the phone's copy, downloaded first if it is not there yet */
export async function resolveFocus(songId: string): Promise<AudioSource> {
  const key = songId.slice(FOCUS_PREFIX.length);
  if (!FOCUS_SOUNDS.includes(key)) throw new Error('集中の音が見つかりません');
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
  const res = await FileSystem.createDownloadResumable(`${focusServerUrl}${url}`, part, {}).downloadAsync();
  if (!res || (res.status !== 200 && res.status !== 206)) {
    await FileSystem.deleteAsync(part, { idempotent: true });
    throw new Error(`集中の音をダウンロードできませんでした（${res?.status ?? '—'}）`);
  }
  await FileSystem.moveAsync({ from: part, to: local });
}
