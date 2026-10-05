import { Alert } from 'react-native';
import type { Router } from 'expo-router';
import { create } from 'zustand';

import { isLocalId } from '../core/localMeta';
import type { MusicItem, SongItem, VideoItem } from '../core/types';
import { removeLocalFile } from '../player/localFiles';
import { usePlayer } from '../state/player';
import { encodeSong } from '../core/songParam';
import { toggleLikeSong } from '../state/likes';
import { useOffline } from '../state/offline';
import { showActionSheet } from './dialogs';
import { requestOfflineSave } from './offlineActions';

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

/** Long-press menu for a song. */
export function songMenu(router: Router, song: SongItem, onChanged?: () => void) {
  const p = usePlayer.getState();
  const local = isLocalId(song.id);
  const artist = song.artists.find((a) => a.id);
  const options = ['次に再生', 'キューに追加'];
  if (!local) options.push('この曲のラジオ');
  const saved = !local && !!useOffline.getState().ids[song.id];
  if (!local) options.push(saved ? 'オフライン保存を削除' : 'オフラインに保存');
  options.push('お気に入りに追加／解除', 'プレイリストに追加', 'タグを編集');
  if (song.album?.id) options.push('アルバムへ');
  if (artist) options.push('アーティストへ');
  if (local) options.push('ライブラリから削除');
  options.push('キャンセル');
  const destructive = local ? options.indexOf('ライブラリから削除') : undefined;

  showActionSheet(
    {
      title: song.title,
      message: song.artists.map((a) => a.name).join(', '),
      options,
      cancelButtonIndex: options.length - 1,
      destructiveButtonIndex: destructive,
    },
    async (i) => {
      const label = options[i];
      try {
        if (label === '次に再生') p.playNext(song);
        else if (label === 'キューに追加') p.enqueue(song);
        else if (label === 'この曲のラジオ') await p.playRadio(song);
        else if (label === 'オフラインに保存') await requestOfflineSave([song]);
        else if (label === 'オフライン保存を削除') {
          await useOffline.getState().remove(song.id);
          onChanged?.();
        } else if (label === 'お気に入りに追加／解除') {
          await toggleLikeSong(song);
          onChanged?.();
        } else if (label === 'タグを編集') {
          router.push({ pathname: '/song-tags', params: { song: encodeSong(song) } });
        } else if (label === 'プレイリストに追加') {
          useAddToPlaylist.setState({ song });
          router.push('/add-to-playlist');
        } else if (label === 'アルバムへ') router.push({ pathname: '/album/[id]', params: { id: song.album!.id! } });
        else if (label === 'アーティストへ') router.push({ pathname: '/artist/[id]', params: { id: artist!.id! } });
        else if (label === 'ライブラリから削除') {
          Alert.alert('削除しますか？', `「${song.title}」を、ライブラリと端末内のコピーから消します。元のファイルは消えません。`, [
            {
              text: '削除',
              style: 'destructive',
              onPress: async () => {
                await removeLocalFile(song.id);
                onChanged?.();
              },
            },
            { text: 'キャンセル', style: 'cancel' },
          ]);
        }
      } catch (e) {
        Alert.alert('エラー', e instanceof Error ? e.message : String(e));
      }
    },
  );
}
