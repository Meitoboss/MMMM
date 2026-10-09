import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View, Pressable } from 'react-native';

import { yt } from '../../src/core';
import { recentInsertIndex } from '../../src/core/homeLayout';
import type { Section, SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { Button, ErrorView, Loading, SectionCarousel, s } from '../../src/ui/components';
import { TrendingShelf } from '../../src/ui/TrendingShelf';
import { OtaBanner } from '../../src/ui/OtaBanner';
import { UpdateBanner } from '../../src/ui/UpdateBanner';
import { useAsync } from '../../src/ui/hooks';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

/** "Music space" wordmark with the three-U mark, like the sidebar of the web version */
function BrandHeader() {
  useScheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 16 }}>
      <Image source={require('../../assets/logo-mark.png')} style={{ width: 30, height: 32 }} contentFit="contain" />
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 }}>
        Music <Text style={{ fontWeight: '300' }}>space</Text>
      </Text>
    </View>
  );
}

export default function Home() {
  useScheme();
  const router = useRouter();
  const { data, error, loading, reload } = useAsync(() => yt.home(), []);
  const [refreshing, setRefreshing] = useState(false);
  const [recent, setRecent] = useState<SongItem[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);

  // songs played on this device, newest first – refreshed every time the home tab comes back into view
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      openDb()
        .then(async (db) => {
          const rows = await repo.recentSongs(db, 20);
          const playlists = await repo.playlists(db);
          if (alive) {
            setRecent(rows);
            setPlaylists(playlists);
          }
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reload();
    setTimeout(() => setRefreshing(false), 600);
  }, [reload]);

  const sections: Section[] = data?.sections ?? [];
  const recentSection: Section = useMemo(() => ({ title: '最近聞いた曲', items: recent }), [recent]);
  const at = recentInsertIndex(sections.map((x) => x.title));

  if (loading && !data && !recent.length) return <Loading />;

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: 12, paddingBottom: MINI_HEIGHT + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentText} />}
    >
      <BrandHeader />
      <OtaBanner />
      <UpdateBanner />
      {playlists.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={[s.h2, { paddingHorizontal: 16, marginBottom: 12 }]}>マイライブラリ</Text>
          {playlists.slice(0, 6).map((p) => (
            <Pressable key={p.id} onPress={() => router.push(`/local-playlist/${p.id}`)} style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={[s.title]}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <TrendingShelf />
      {sections.slice(0, at).map((x, i) => <SectionCarousel key={`${x.title}-${i}`} section={x} />)}
      {/* directly below "Today's hits" / "Trending" */}
      {recent.length ? (
        <SectionCarousel section={recentSection} onMore={() => router.push('recent-songs')} />
      ) : (
        <View style={{ marginBottom: 20 }}>
          <Text style={[s.h2]}>最近聞いた曲</Text>
          <Text style={[s.sub, { paddingHorizontal: 16 }]}>まだ再生した曲がありません。曲を再生すると、ここに並びます。</Text>
        </View>
      )}
      {sections.slice(at).map((x, i) => <SectionCarousel key={`${x.title}-${at + i}`} section={x} />)}
      {error && !data && (
        <View style={{ alignItems: 'center', padding: 24 }}>
          <ErrorView message={error} />
          <Button label="再試行" icon="refresh" onPress={reload} />
        </View>
      )}
    </ScrollView>
  );
}
