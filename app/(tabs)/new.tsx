import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { yt } from '../../src/core';
import { type AppleRelease, sameTitle } from '../../src/core/appleNew';
import type { AlbumItem, MusicItem, SongItem } from '../../src/core/types';
import { cachedAppleReleases, getAppleReleases } from '../../src/state/appleNew';
import { cachedReleaseGroups, getReleaseGroups, type ReleaseGroups } from '../../src/state/newReleases';
import { usePlayer } from '../../src/state/player';
import { openItem } from '../../src/ui/actions';
import { SectionCarousel } from '../../src/ui/components';
import { LIST_BOTTOM, colors, useScheme } from '../../src/ui/theme';

/** a release of Apple Music: its picture and name; a tap finds it on YouTube Music and opens it there */
async function openApple(router: ReturnType<typeof useRouter>, r: AppleRelease): Promise<void> {
  const page = await yt.searchAll(`${r.artist} ${r.name}`).catch(() => null);
  const found: MusicItem[] = page?.items ?? [];
  const album = found.find((i): i is AlbumItem => i.kind === 'album' && sameTitle(i.title, r.name)) ?? found.find((i): i is AlbumItem => i.kind === 'album');
  if (album) return openItem(router, album);
  const song = found.find((i): i is SongItem => i.kind === 'song');
  if (song) void usePlayer.getState().playSongs([song], 0);
}

/** the Apple Music shelf, in Apple's own layout: a title with a chevron, then two rows of pictures that slide sideways */
function AppleShelf({ releases }: { releases: AppleRelease[] }) {
  const router = useRouter();
  useScheme();
  const { width } = useWindowDimensions();
  if (!releases.length) return null;
  const cardWidth = width * 0.42;
  const columns: AppleRelease[][] = [];
  for (let i = 0; i < releases.length; i += 2) columns.push(releases.slice(i, i + 2));
  const card = (r: AppleRelease) => (
    <Pressable key={r.id} onPress={() => void openApple(router, r)} accessibilityRole="button" style={{ width: cardWidth, gap: 6 }}>
      {!!r.artwork && <Image source={{ uri: r.artwork }} style={{ width: cardWidth, height: cardWidth, borderRadius: 10, backgroundColor: colors.surface2 }} />}
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15 }}>{r.name}</Text>
      <Text numberOfLines={1} style={{ color: colors.sub, fontSize: 14 }}>{r.artist}</Text>
    </Pressable>
  );
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 14 }}>
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800' }}>Apple Music の新譜</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.sub} style={{ marginLeft: 6, marginTop: 4 }} />
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={columns}
        keyExtractor={(c) => c[0].id}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 16 }}
        renderItem={({ item }) => <View style={{ gap: 18 }}>{item.map(card)}</View>}
      />
    </View>
  );
}

/** 新着: one shelf per bookmarked artist (always on top), then the Apple Music new releases, then the artists you may like */
export default function NewTab() {
  useScheme();
  const [groups, setGroups] = useState<ReleaseGroups>(cachedReleaseGroups);
  const [apple, setApple] = useState<AppleRelease[]>(cachedAppleReleases);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((force = false) => {
    setRefreshing(force);
    Promise.all([getReleaseGroups(force), getAppleReleases(force)])
      .then(([g, a]) => {
        setGroups(g);
        setApple(a);
      })
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const bookmarked = groups.bookmarked.map((a) => ({ title: a.name, items: a.items }));
  const others = groups.others.map((a) => ({ title: `${a.name}（おすすめ）`, items: a.items }));
  const empty = !bookmarked.length && !apple.length && !others.length;

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: LIST_BOTTOM }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accentText} />}>
      {bookmarked.map((x, i) => (
        <SectionCarousel key={`b-${x.title}-${i}`} section={x} />
      ))}
      <AppleShelf releases={apple} />
      {others.map((x, i) => (
        <SectionCarousel key={`o-${x.title}-${i}`} section={x} />
      ))}
      {empty && (
        <View style={{ padding: 24, gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>まだ新作がありません</Text>
          <Text style={{ color: colors.sub, fontSize: 13 }}>アーティストをブックマークすると、その人の新しい曲やアルバムが、ここに並びます。</Text>
        </View>
      )}
    </ScrollView>
  );
}
