import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { yt } from '../../src/core';
import { ErrorView, Loading, SectionCarousel } from '../../src/ui/components';
import { useAsync } from '../../src/ui/hooks';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

export default function Home() {
  const { data, error, loading, reload } = useAsync(() => yt.home(), []);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reload();
    setTimeout(() => setRefreshing(false), 600);
  }, [reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: 12, paddingBottom: MINI_HEIGHT + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {data?.sections.map((s, i) => <SectionCarousel key={`${s.title}-${i}`} section={s} />)}
    </ScrollView>
  );
}
