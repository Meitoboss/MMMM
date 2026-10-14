import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { yt } from '../../src/core';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { usePlayer } from '../../src/state/player';
import { Button, Cover, ErrorView, Loading, SongRow, s } from '../../src/ui/components';
import { useAsync } from '../../src/ui/hooks';
import { requestOfflineSave } from '../../src/ui/offlineActions';
import { LIST_BOTTOM, colors, useScheme } from '../../src/ui/theme';

export default function Album() {
  useScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const play = usePlayer((p) => p.playSongs);
  const { data, error, loading, reload } = useAsync(() => yt.album(id), [id]);
  const [bookmarked, setBookmarked] = useState(false);
  // the year of an album is what the release order of the Library uses: remembered whenever the page shows it
  useEffect(() => {
    const year = data?.year;
    if (year && /^(19|20)\d{2}/.test(year)) void openDb().then((db) => repo.setAlbumYear(db, id, year.slice(0, 4))).catch(() => undefined);
  }, [data?.year, id]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorView message={error ?? '見つかりません'} onRetry={reload} />;

  return (
    <FlatList
      data={data.songs}
      keyExtractor={(x, i) => `${x.id}-${i}`}
      contentContainerStyle={{ paddingBottom: LIST_BOTTOM }}
      ListHeaderComponent={
        <View style={{ alignItems: 'center', padding: 16, gap: 6 }}>
          <Stack.Screen options={{ title: '' }} />
          <Cover uri={data.thumbnail} size={220} />
          <Text style={[s.h1, { textAlign: 'center', marginTop: 8 }]}>{data.title}</Text>
          <Text style={s.sub}>{[data.author?.name, data.year].filter(Boolean).join(' • ')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <Button label="再生" icon="play" onPress={() => void play(data.songs, 0)} />
            <Button label="シャッフル" icon="shuffle" secondary onPress={() => { usePlayer.setState({ shuffle: true }); void play(data.songs, 0); }} />
            <Button label="オフライン" icon="arrow-down-circle-outline" secondary onPress={() => void requestOfflineSave(data.songs)} />
            <Pressable
              onPress={async () => setBookmarked(await repo.toggleAlbumBookmark(await openDb(), { kind: 'album', id, title: data.title, artists: data.author ? [data.author] : [], year: data.year, thumbnail: data.thumbnail }))}
              style={{ justifyContent: 'center', marginTop: 12 }}>
              <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={26} color={colors.accentText} />
            </Pressable>
          </View>
        </View>
      }
      renderItem={({ item, index }) => <SongRow song={item} index={index} onPress={() => void play(data.songs, index)} />}
    />
  );
}
