import { ActionSheetIOS, Alert } from 'react-native';
import type { Router } from 'expo-router';
import { create } from 'zustand';

import type { MusicItem, SongItem, VideoItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { usePlayer } from '../state/player';

/** Song waiting to be added to a playlist (read by app/add-to-playlist.tsx) */
export const useAddToPlaylist = create<{ song?: SongItem }>(() => ({}));

export function videoToSong(v: VideoItem): SongItem {
  return { kind: 'song', id: v.id, title: v.title, artists: v.artists, durationText: v.durationText, thumbnail: v.thumbnail, explicit: false };
}

/** Tap on any search / home item. `context` lets a song start a queue made of its siblings. */
export function openItem(router: Router, item: MusicItem, context?: SongItem[]) {
  switch (item.kind) {
    case 'song': {
      const list = context?.length ? context : [item];
      void usePlayer.getState().playSongs(list, Math.max(0, list.findIndex((s) => s.id === item.id)));
      break;
    }
    case 'video':
      void usePlayer.getState().playSongs([videoToSong(item)], 0);
      break;
    case 'album':
      router.push({ pathname: '/album/[id]', params: { id: item.id } });
      break;
    case 'artist':
      router.push({ pathname: '/artist/[id]', params: { id: item.id } });
      break;
    case 'playlist':
      router.push({ pathname: '/playlist/[id]', params: { id: item.id } });
      break;
  }
}

/** Long-press menu for a song (RiMusic's "Play next / Enqueue / Add to playlist / Radio / Like"). */
export function songMenu(router: Router, song: SongItem, onChanged?: () => void) {
  const p = usePlayer.getState();
  const artist = song.artists.find((a) => a.id);
  const options = ['Play next', 'Add to queue', 'Start radio', 'Like / Unlike', 'Add to playlist'];
  if (song.album?.id) options.push('Go to album');
  if (artist) options.push('Go to artist');
  options.push('Cancel');

  ActionSheetIOS.showActionSheetWithOptions(
    { title: song.title, message: song.artists.map((a) => a.name).join(', '), options, cancelButtonIndex: options.length - 1 },
    async (i) => {
      const label = options[i];
      try {
        if (label === 'Play next') p.playNext(song);
        else if (label === 'Add to queue') p.enqueue(song);
        else if (label === 'Start radio') await p.playRadio(song);
        else if (label === 'Like / Unlike') {
          await repo.toggleLike(await openDb(), song);
          onChanged?.();
        } else if (label === 'Add to playlist') {
          useAddToPlaylist.setState({ song });
          router.push('/add-to-playlist');
        } else if (label === 'Go to album') router.push({ pathname: '/album/[id]', params: { id: song.album!.id! } });
        else if (label === 'Go to artist') router.push({ pathname: '/artist/[id]', params: { id: artist!.id! } });
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : String(e));
      }
    },
  );
}
