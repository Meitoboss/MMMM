import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import type { AlbumItem } from '../../src/core/types';
import { LIST_BOTTOM } from '../../src/ui/theme';
import { SectionCarousel, s } from '../../src/ui/components';
import { colors, useScheme } from '../../src/ui/theme';
import { getReleaseGroups, type ReleaseGroups } from '../../src/state/newReleases';

const EMPTY: ReleaseGroups = { bookmarked: [], listened: [], recommended: [] };

/** 新着: the new albums and singles of the artists around the ones you bookmarked */
export default function NewTab() {
  useScheme();
  const [groups, setGroups] = useState<ReleaseGroups>(EMPTY);
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

  const sections: { title: string; items: AlbumItem[] }[] = [
    { title: 'ブックマークしたアーティストの新作', items: groups.bookmarked },
    { title: 'よく聴くアーティストの新作', items: groups.listened },
    { title: 'おすすめのアーティストの新作', items: groups.recommended },
  ].filter((x) => x.items.length > 0);

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: LIST_BOTTOM }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accentText} />}>
      {sections.map((x) => (
        <SectionCarousel key={x.title} section={{ title: x.title, items: x.items }} />
      ))}
      {!sections.length && (
        <View style={{ padding: 24, gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>まだ新作がありません</Text>
          <Text style={s.sub}>アーティストをブックマークすると、その人の新しいアルバムやシングルが、ここに並びます。</Text>
        </View>
      )}
    </ScrollView>
  );
}
