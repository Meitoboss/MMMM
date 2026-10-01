import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { yt } from '../../src/core';
import type { SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { usePlayer } from '../../src/state/player';
import { Button, Cover, ErrorView, Loading, SongRow, s } from '../../src/ui/components';
import { useAsync } from '../../src/ui/hooks';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

export default function RemotePlaylist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const play = usePlayer((p) => p.playSongs);
  const { data, error, loading, reload } = useAsync(() => yt.playlist(id), [id]);
  const [extra, setExtra] = useState<SongItem[]>([]);
  const [token, setToken] = useState<string | undefined | null>(null); // null = use page token
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorView message={error ?? 'Not found'} onRetry={reload} />;

  const songs = [...data.songs, ...extra];
  const next = token === null ? data.continuation : token;
  async function more() {
    if (!next || busy) return;
    setBusy(true);
    try {
      const r = await yt.playlistContinuation(next);
      setExtra((e) => [...e, ...r.songs]);
      setToken(r.continuation);
    } catch { setToken(undefined); } finally { setBusy(false); }
  }

  return (
    <FlatList
      data={songs}
      keyExtractor={(x, i) => `${x.id}-${i}`}
      onEndReached={more}
      onEndReachedThreshold={0.6}
      contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
      ListFooterComponent={busy ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} /> : null}
      ListHeaderComponent={
        <View style={{ alignItems: 'center', padding: 16, gap: 6 }}>
          <Stack.Screen options={{ title: '' }} />
          <Cover uri={data.thumbnail} size={200} />
          <Text style={[s.h1, { textAlign: 'center', marginTop: 8 }]}>{data.title}</Text>
          {!!data.author && <Text style={s.sub}>{data.author.name}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Play" icon="play" onPress={() => void play(songs, 0)} />
            <Button label="Shuffle" icon="shuffle" secondary onPress={() => { usePlayer.setState({ shuffle: true }); void play(songs, 0); }} />
            <Button label="Save" icon="download-outline" secondary onPress={async () => {
              const full = await yt.playlistComplete({ ...data, songs, continuation: next ?? undefined });
              const db = await openDb();
              const pid = await repo.createPlaylist(db, data.title, id);
              await repo.addToPlaylist(db, pid, full.songs);
            }} />
          </View>
        </View>
      }
      renderItem={({ item, index }) => <SongRow song={item} index={index} onPress={() => void play(songs, index)} />}
    />
  );
}
