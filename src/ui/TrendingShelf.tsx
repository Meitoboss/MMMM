import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { cleanCountry, countryLabel } from '../core/trending';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { useTrending } from '../state/trending';
import { Cover, s } from './components';
import { colors, useScheme } from './theme';

/** Home: the top of the chart of your country, as songs of YouTube Music. "すべて見る" opens the whole chart. */
/** the look of a shelf title (the same as the other shelves); read at each render, so a theme change shows at once */
const heading = () => ({ color: colors.text, fontSize: 18, fontWeight: '700' as const, paddingRight: 16 });

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

  if (songs.length)
    return (
      <View style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16 }}>
          <Text style={heading()}>{title}</Text>
          <Pressable hitSlop={8} onPress={() => router.push('/trending')}>
            <Text style={{ color: colors.accentText, fontWeight: '700' }}>すべて見る ›</Text>
          </Pressable>
        </View>
        {/* big cards that scroll sideways: a tap plays from that song on */}
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={songs}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item, index }) => (
            <Pressable onPress={() => void usePlayer.getState().playSongs(songs, index)} style={{ width: 210 }}>
              <Cover uri={item.thumbnail} size={210} />
              <Text numberOfLines={2} style={[s.title, { marginTop: 8 }]}>{item.title}</Text>
              <Text numberOfLines={1} style={s.sub}>{item.artists.map((a) => a.name).join(', ')}</Text>
            </Pressable>
          )}
        />
      </View>
    );
  return (
    <View style={{ marginBottom: 20 }} testID="trending-placeholder">
      <Text style={heading()}>{title}</Text>
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
