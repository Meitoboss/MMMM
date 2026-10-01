import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { yt } from '../../src/core';
import type { SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { usePlayer } from '../../src/state/player';
import { Button, Cover, ErrorView, Loading, SectionCarousel, s } from '../../src/ui/components';
import { useAsync } from '../../src/ui/hooks';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

export default function Artist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => yt.artist(id), [id]);
  const [bookmarked, setBookmarked] = useState(false);
  const playSongs = usePlayer((p) => p.playSongs);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorView message={error ?? 'Not found'} onRetry={reload} />;

  const topSongs = data.sections.flatMap((x) => x.items).filter((i): i is SongItem => i.kind === 'song');

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}>
      <Stack.Screen options={{ title: data.name }} />
      <View style={{ alignItems: 'center', padding: 16, gap: 6 }}>
        <Cover uri={data.thumbnail} size={180} round />
        <Text style={[s.h1, { textAlign: 'center' }]}>{data.name}</Text>
        {!!data.subscribersText && <Text style={s.sub}>{data.subscribersText}</Text>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!!topSongs.length && <Button label="Play" icon="play" onPress={() => void playSongs(topSongs, 0)} />}
          {!!data.radioPlaylistId && topSongs[0] && <Button label="Radio" icon="radio" secondary onPress={() => void usePlayer.getState().playRadio(topSongs[0])} />}
          <Pressable
            onPress={async () => setBookmarked(await repo.toggleArtistBookmark(await openDb(), { kind: 'artist', id, name: data.name, thumbnail: data.thumbnail }))}
            style={{ justifyContent: 'center', marginTop: 12 }}>
            <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={26} color={colors.accent} />
          </Pressable>
        </View>
      </View>
      {data.sections.map((sec, i) => <SectionCarousel key={`${sec.title}-${i}`} section={sec} />)}
      {!!data.description && <Text style={{ color: colors.sub, paddingHorizontal: 16 }}>{data.description}</Text>}
    </ScrollView>
  );
}
