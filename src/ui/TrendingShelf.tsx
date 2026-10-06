import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { cleanCountry, countryLabel } from '../core/trending';
import { useSettings } from '../state/settings';
import { useTrending } from '../state/trending';
import { SectionCarousel, s } from './components';
import { colors, useScheme } from './theme';

/** Home: the top of the chart of your country, as songs of YouTube Music. "すべて見る" opens the whole chart. */
export function TrendingShelf() {
  useScheme();
  const router = useRouter();
  const country = useSettings((st) => cleanCountry(st.trendingCountry));
  const entries = useTrending((t) => t.entries);
  const loading = useTrending((t) => t.loading);
  const error = useTrending((t) => t.error);
  const load = useTrending((t) => t.load);
  // a fresh saved chart is shown at once, without any network
  useEffect(() => {
    void load();
  }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const songs = useMemo(() => entries.flatMap((e) => (e.song ? [e.song] : [])).slice(0, 10), [entries]);
  const title = `流行（${countryLabel(country)}）`;

  if (songs.length) return <SectionCarousel section={{ title, items: songs }} onMore={() => router.push('/trending')} />;
  return (
    <View style={{ marginBottom: 20 }} testID="trending-placeholder">
      <Text style={s.h2}>{title}</Text>
      {error ? (
        <Pressable onPress={() => void load(true)}>
          <Text style={[s.sub, { paddingHorizontal: 16 }]}>
            ランキングを取得できませんでした。<Text style={{ color: colors.accentText, fontWeight: '700' }}>再試行</Text>
          </Text>
        </Pressable>
      ) : (
        <Text style={[s.sub, { paddingHorizontal: 16 }]}>{loading || !entries.length ? 'ランキングを取得中…' : '曲を探しています…'}</Text>
      )}
    </View>
  );
}
