import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { cachedReleaseGroups, getReleaseGroups, type ReleaseGroups } from '../../src/state/newReleases';
import { SectionCarousel } from '../../src/ui/components';
import { LIST_BOTTOM, colors, useScheme } from '../../src/ui/theme';

/** 新着: one shelf per artist – the artists you bookmarked first, then the ones you may like */
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
    ...groups.bookmarked.map((a) => ({ title: a.name, items: a.items })),
    ...groups.others.map((a) => ({ title: `${a.name}（おすすめ）`, items: a.items })),
  ];

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: LIST_BOTTOM }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accentText} />}>
      {sections.map((x, i) => (
        <SectionCarousel key={`${x.title}-${i}`} section={x} />
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
