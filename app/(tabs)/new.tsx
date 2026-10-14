import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { getReleaseGroups, cachedReleaseGroups, type ReleaseGroups } from '../../src/state/newReleases';
import { SectionCarousel } from '../../src/ui/components';
import { LIST_BOTTOM, colors, useScheme } from '../../src/ui/theme';

/** 新着: the new songs and albums of the artists you bookmarked come first, then the other artists you may like */
export default function NewTab() {
  useScheme();
  const [groups, setGroups] = useState<ReleaseGroups>(cachedReleaseGroups);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((force = false) => {
    setRefreshing(force);
    getReleaseGroups(force)
      .then(setGroups)
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const sections = [
    { title: 'ブックマークしたアーティストの新曲', items: groups.bookmarkedSongs },
    { title: 'ブックマークしたアーティストの新作', items: groups.bookmarked },
    { title: 'そのほかの新曲', items: groups.otherSongs },
    { title: 'そのほかのアーティストの新作', items: groups.others },
  ].filter((x) => x.items.length > 0);

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: LIST_BOTTOM }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accentText} />}>
      {sections.map((x) => (
        <SectionCarousel key={x.title} section={x} />
      ))}
      {!sections.length && (
        <View style={{ padding: 24, gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>まだ新作がありません</Text>
          <Text style={{ color: colors.sub, fontSize: 13 }}>アーティストをブックマークすると、その人の新しい曲やアルバムが、ここに並びます。</Text>
        </View>
      )}
    </ScrollView>
  );
}
