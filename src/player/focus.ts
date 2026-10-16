import { Asset } from 'expo-asset';

import { LOCAL_ARTIST, LOCAL_PREFIX } from '../core/localMeta';
import type { AudioSource, SongItem } from '../core/types';

/**
 * The 集中 (focus) sounds that come with the app. The sine tone is not in these files: it is played beside them (player/tone.ts).
 * They are played as local songs, so the player, the queue and the lists handle them like the files on the phone.
 */
const FOCUS_PREFIX = `${LOCAL_PREFIX}focus-`;

const TRACKS: { key: string; module: number }[] = [
  { key: 'focus_loop', module: require('../../assets/focus/focus_loop.mp3') },
  { key: 'relax_loop', module: require('../../assets/focus/relax_loop.mp3') },
  { key: 'meditate_loop', module: require('../../assets/focus/meditate_loop.mp3') },
  { key: 'sleep_loop', module: require('../../assets/focus/sleep_loop.mp3') },
  { key: 'anxiety_loop', module: require('../../assets/focus/anxiety_loop.mp3') },
  { key: 'spiritual_loop', module: require('../../assets/focus/spiritual_loop.mp3') },
  { key: 'n011_wind_1', module: require('../../assets/focus/n011_wind_1.mp3') },
  { key: 'so_852hz', module: require('../../assets/focus/so_852hz.mp3') },
  { key: 'onboarding', module: require('../../assets/focus/onboarding.mp3') },
  { key: 'onboarding_trs_281', module: require('../../assets/focus/onboarding_trs_281.mp3') },
  { key: 'sleep_06', module: require('../../assets/focus/sleep_06.mp3') },
  { key: 'sleep_06_trs_223', module: require('../../assets/focus/sleep_06_trs_223.mp3') },
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
