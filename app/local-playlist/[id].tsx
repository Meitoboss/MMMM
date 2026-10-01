import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import type { SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { usePlayer } from '../../src/state/player';
import { Button, SongRow } from '../../src/ui/components';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

export default function LocalPlaylist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = Number(id);
  const play = usePlayer((p) => p.playSongs);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const db = await openDb();
    setSongs(await repo.playlistSongs(db, pid));
    setName((await repo.playlists(db)).find((p) => p.id === pid)?.name ?? '');
  }, [pid]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: name }} />
      <FlatList
        data={songs}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
        ListHeaderComponent={songs.length ? (
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
            <Button label="Play" icon="play" onPress={() => void play(songs, 0)} />
            <Button label="Rename" secondary onPress={() => Alert.prompt('Rename playlist', undefined, async (t) => { if (t?.trim()) { await repo.renamePlaylist(await openDb(), pid, t.trim()); void load(); } }, 'plain-text', name)} />
          </View>
        ) : null}
        ListEmptyComponent={<Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>Empty playlist</Text>}
        renderItem={({ item, index }) => (
          <SongRow song={item} onPress={() => void play(songs, index)}
            right={
              <Pressable hitSlop={10} onPress={async () => { await repo.removeFromPlaylist(await openDb(), pid, item.id); void load(); }}>
                <Ionicons name="remove-circle-outline" size={20} color={colors.sub} />
              </Pressable>
            } />
        )}
      />
    </View>
  );
}
