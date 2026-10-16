import { Asset } from 'expo-asset';

import { LOCAL_ARTIST, LOCAL_PREFIX } from '../core/localMeta';
import type { AudioSource, SongItem } from '../core/types';

/**
 * The 集中 (focus) sounds that come with the app. Each one has a sine tone mixed in (432 Hz, under the sound).
 * They are played as local songs, so the player, the queue and the lists handle them like the files on the phone.
 */
const FOCUS_PREFIX = `${LOCAL_PREFIX}focus-`;

const TRACKS: { key: string; module: number }[] = [
  { key: 'focus_loop', module: require('../../assets/focus/focus_loop.m4a') },
  { key: 'relax_loop', module: require('../../assets/focus/relax_loop.m4a') },
  { key: 'meditate_loop', module: require('../../assets/focus/meditate_loop.m4a') },
  { key: 'sleep_loop', module: require('../../assets/focus/sleep_loop.m4a') },
  { key: 'anxiety_loop', module: require('../../assets/focus/anxiety_loop.m4a') },
  { key: 'spiritual_loop', module: require('../../assets/focus/spiritual_loop.m4a') },
  { key: 'n011_wind_1', module: require('../../assets/focus/n011_wind_1.m4a') },
  { key: 'so_852hz', module: require('../../assets/focus/so_852hz.m4a') },
  { key: 'onboarding', module: require('../../assets/focus/onboarding.m4a') },
  { key: 'onboarding_trs_281', module: require('../../assets/focus/onboarding_trs_281.m4a') },
  { key: 'sleep_06', module: require('../../assets/focus/sleep_06.m4a') },
  { key: 'sleep_06_trs_223', module: require('../../assets/focus/sleep_06_trs_223.m4a') },
];

export const isFocusId = (id: string): boolean => id.startsWith(FOCUS_PREFIX);

/** the focus sounds as songs, in the order they are kept in the app */
export function focusSongs(): SongItem[] {
  return TRACKS.map((t) => ({
    kind: 'song',
    id: `${FOCUS_PREFIX}${t.key}`,
    title: t.key,
    artists: [{ name: LOCAL_ARTIST }],
    explicit: false,
  }));
}

/** where the player can read one focus sound from (the app copies it out of its bundle the first time) */
export async function resolveFocus(songId: string): Promise<AudioSource> {
  const track = TRACKS.find((t) => `${FOCUS_PREFIX}${t.key}` === songId);
  if (!track) throw new Error('集中の音が見つかりません');
  const asset = Asset.fromModule(track.module);
  if (!asset.localUri) await asset.downloadAsync();
  const url = asset.localUri ?? asset.uri;
  if (!url) throw new Error('集中の音を読み込めませんでした');
  return { url, via: 'local', note: 'focus sound' };
}
