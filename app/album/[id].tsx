import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { yt } from '../../src/core';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { usePlayer } from '../../src/state/player';
import { Button, Cover, ErrorView, Loading, SongRow, s } from '../../src/ui/components';
import { useAsync } from '../../src/ui/hooks';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

export default function Album() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const play = usePlayer((p) => p.playSongs);
  const { data, error, loading, reload } = useAsync(() => yt.album(id), [id]);
  const [bookmarked, setBookmarked] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorView message={error ?? 'Not found'} onRetry={reload} />;

  return (
    <FlatList
      data={data.songs}
      keyExtractor={(x, i) => `${x.id}-${i}`}
      contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
      ListHeaderComponent={
        <View style={{ alignItems: 'center', padding: 16, gap: 6 }}>
          <Stack.Screen options={{ title: '' }} />
          <Cover uri={data.thumbnail} size={220} />
          <Text style={[s.h1, { textAlign: 'center', marginTop: 8 }]}>{data.title}</Text>
          <Text style={s.sub}>{[data.author?.name, data.year].filter(Boolean).join(' • ')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Play" icon="play" onPress={() => void play(data.songs, 0)} />
            <Button label="Shuffle" icon="shuffle" secondary onPress={() => { usePlayer.setState({ shuffle: true }); void play(data.songs, 0); }} />
            <Pressable
              onPress={async () => setBookmarked(await repo.toggleAlbumBookmark(await openDb(), { kind: 'album', id, title: data.title, artists: data.author ? [data.author] : [], year: data.year, thumbnail: data.thumbnail }))}
              style={{ justifyContent: 'center', marginTop: 12 }}>
              <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={26} color={colors.accent} />
            </Pressable>
          </View>
        </View>
      }
      renderItem={({ item, index }) => <SongRow song={item} index={index} onPress={() => void play(data.songs, index)} />}
    />
  );
}
