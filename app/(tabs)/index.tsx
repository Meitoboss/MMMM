import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { yt } from '../../src/core';
import { recentInsertIndex } from '../../src/core/homeLayout';
import type { Section, SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { Button, ErrorView, Loading, SectionCarousel, s } from '../../src/ui/components';
import { ArtistShelf } from '../../src/ui/ArtistShelf';
import { ForgottenShelf, OnThisDayShelf, TimeMoodShelf } from '../../src/ui/HomeShelves';
import { TasteShelf } from '../../src/ui/TasteShelf';
import { TrendingShelf } from '../../src/ui/TrendingShelf';
import { OtaBanner } from '../../src/ui/OtaBanner';
import { UpdateBanner } from '../../src/ui/UpdateBanner';
import { useAsync } from '../../src/ui/hooks';
import { LIST_BOTTOM, colors, useScheme } from '../../src/ui/theme';

export default function Home() {
  useScheme();
  const { data, error, loading, reload } = useAsync(() => yt.home(), []);
  const [refreshing, setRefreshing] = useState(false);
  const [recent, setRecent] = useState<SongItem[]>([]);

  // songs played on this device, newest first – refreshed every time the home tab comes back into view
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      openDb()
        .then((db) => repo.recentSongs(db, 20))
        .then((rows) => alive && setRecent(rows))
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
      contentContainerStyle={{ paddingTop: 12, paddingBottom: LIST_BOTTOM }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentText} />}
    >
      <OtaBanner />
      <UpdateBanner />
      <TrendingShelf />
      <ArtistShelf />
      <TasteShelf />
      <OnThisDayShelf />
      <ForgottenShelf />
      <TimeMoodShelf />
      {sections.slice(0, at).map((x, i) => <SectionCarousel key={`${x.title}-${i}`} section={x} />)}
      {/* directly below "Today's hits" / "Trending" */}
      {recent.length ? (
        <SectionCarousel section={recentSection} />
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
