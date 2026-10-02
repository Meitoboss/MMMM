import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { moveItem } from '../../src/core/reorder';
import type { SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { usePlayer } from '../../src/state/player';
import { Button, Cover, s } from '../../src/ui/components';
import { DraggableList } from '../../src/ui/DraggableList';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

const ROW_HEIGHT = 64;

export default function LocalPlaylist() {
  useScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = Number(id);
  const play = usePlayer((p) => p.playSongs);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState(false);

  const load = useCallback(async () => {
    const db = await openDb();
    setSongs(await repo.playlistSongs(db, pid));
    setName((await repo.playlists(db)).find((p) => p.id === pid)?.name ?? '');
  }, [pid]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onReorder = async (songId: string, from: number, to: number) => {
    setSongs((cur) => moveItem(cur, from, to)); // show the new order at once
    try {
      await repo.movePlaylistSong(await openDb(), pid, songId, to);
    } catch (e) {
      Alert.alert('並べ替えを保存できませんでした', e instanceof Error ? e.message : String(e));
      void load();
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView scrollEnabled={!dragging} contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}>
        {songs.length ? (
          <View>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Button label="再生" icon="play" onPress={() => void play(songs, 0)} />
              <Button label="名前を変更" secondary onPress={() => Alert.prompt('プレイリスト名を変更', undefined, async (t) => { if (t?.trim()) { await repo.renamePlaylist(await openDb(), pid, t.trim()); void load(); } }, 'plain-text', name)} />
            </View>
            <Text style={[s.sub, { paddingHorizontal: 16, marginTop: 8, marginBottom: 4 }]}>右の「≡」をドラッグして、曲の順番を入れ替えられます。</Text>
          </View>
        ) : (
          <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>プレイリストは空です</Text>
        )}

        <DraggableList
          items={songs}
          keyOf={(x) => x.id}
          rowHeight={ROW_HEIGHT}
          onDragChange={setDragging}
          onReorder={(key, from, to) => void onReorder(key, from, to)}
          renderRow={(item, { index, handle }) => (
            <Pressable
              onPress={() => void play(songs, index)}
              style={[s.row, { height: ROW_HEIGHT, paddingVertical: 0 }]}
            >
              <Cover uri={item.thumbnail} size={48} />
              <View style={s.rowText}>
                <Text style={s.title} numberOfLines={1}>{item.title}</Text>
                <Text style={s.sub} numberOfLines={1}>{item.artists.map((a) => a.name).join(', ')}{item.durationText ? ` • ${item.durationText}` : ''}</Text>
              </View>
              <Pressable hitSlop={10} onPress={async () => { await repo.removeFromPlaylist(await openDb(), pid, item.id); void load(); }}>
                <Ionicons name="remove-circle-outline" size={22} color={colors.sub} />
              </Pressable>
              {handle}
            </Pressable>
          )}
        />
      </ScrollView>
    </View>
  );
}
