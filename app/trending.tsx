import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { COUNTRIES, LIMITS, cleanCountry, countryLabel } from '../src/core/trending';
import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import { usePlayer } from '../src/state/player';
import { useSettings } from '../src/state/settings';
import { useTrending } from '../src/state/trending';
import { Button, Cover, ErrorView, s } from '../src/ui/components';
import { MINI_HEIGHT, colors, useScheme } from '../src/ui/theme';

/** The chart of a country (Apple Music), as songs of YouTube Music – play, shuffle, or keep it as a playlist. */
export default function Trending() {
  useScheme();
  const { entries, progress, loading, error, load, setCountry, setLimit } = useTrending();
  const country = useSettings((st) => cleanCountry(st.trendingCountry));
  const limit = useSettings((st) => st.trendingLimit);
  const playSongs = usePlayer((p) => p.playSongs);

  useEffect(() => {
    void load(); // a fresh saved chart: no network, no search
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const songs = useMemo(() => entries.flatMap((e) => (e.song ? [e.song] : [])), [entries]);
  const matching = !!progress && progress.done < progress.total;

  const play = (shuffle: boolean, from = 0) => {
    if (!songs.length) return;
    usePlayer.setState({ shuffle });
    void playSongs(songs, from);
  };

  const keep = async () => {
    try {
      const db = await openDb();
      const day = new Date().toISOString().slice(0, 10);
      const id = await repo.createPlaylist(db, `流行 ${countryLabel(country)} ${day}`);
      const n = await repo.addToPlaylist(db, id, songs);
      Alert.alert('プレイリストにしました', `${n}曲を、ライブラリのプレイリストに入れました`);
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    }
  };

  const chip = (on: boolean) => ({ paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center' as const, borderRadius: 18, backgroundColor: on ? colors.accent : colors.surface2 });
  const chipText = (on: boolean) => ({ color: on ? colors.onAccent : colors.text, fontWeight: on ? ('700' as const) : ('500' as const), fontSize: 14, lineHeight: 20 });

  const header = (
    <View style={{ paddingBottom: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 10 }}>
        {COUNTRIES.map((c) => (
          <Pressable key={c.code} onPress={() => setCountry(c.code)} style={chip(country === c.code)}>
            <Text style={chipText(country === c.code)}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 }}>
        {LIMITS.map((n) => (
          <Pressable key={n} onPress={() => setLimit(n)} style={chip(limit === n)}>
            <Text style={chipText(limit === n)}>{n}曲</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, flexWrap: 'wrap' }}>
        <Button label="再生" icon="play" onPress={() => play(false)} />
        <Button label="シャッフル" icon="shuffle" secondary onPress={() => play(true)} />
        <Button label="プレイリストに" icon="add" secondary onPress={() => void keep()} />
        <Button label="更新" icon="refresh" secondary onPress={() => void load(true)} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 2 }}>
        {(loading && !entries.length) && <Text style={s.sub}>ランキングを取得中…</Text>}
        {matching && <Text style={{ color: colors.accentText, fontSize: 12, fontWeight: '700' }}>曲を探しています {progress.done} / {progress.total}</Text>}
        {!!error && <Text style={{ color: colors.danger, fontSize: 12 }}>{entries.length ? `更新できませんでした（前回の結果を表示しています）\n${error}` : error}</Text>}
      </View>
    </View>
  );

  if (error && !entries.length) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <ErrorView message={error} onRetry={() => void load(true)} />
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => `${e.rank}-${e.title}`}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
      ListFooterComponent={
        <Text style={[s.sub, { textAlign: 'center', padding: 16 }]}>ランキング: Apple Music（{countryLabel(country)}）。再生は、YouTube Music の曲で行います。</Text>
      }
      renderItem={({ item }) => {
        const found = !!item.song;
        return (
          <Pressable
            testID={`trend-${item.rank}`}
            disabled={!found}
            onPress={() => play(false, Math.max(0, songs.findIndex((x) => x.id === item.song?.id)))}
            style={[s.row, { opacity: item.status === 'none' ? 0.45 : 1 }]}
          >
            <Text style={{ width: 28, textAlign: 'center', color: item.rank <= 3 ? colors.accentText : colors.sub, fontWeight: '800' }}>{item.rank}</Text>
            <Cover uri={item.song?.thumbnail ?? item.artworkUrl} size={48} />
            <View style={s.rowText}>
              <Text style={s.title} numberOfLines={1}>{item.title}</Text>
              <Text style={s.sub} numberOfLines={1}>{item.status === 'none' ? `${item.artist}・YouTube Music で見つかりません` : item.artist}</Text>
            </View>
            {item.status === 'pending' && <ActivityIndicator size="small" color={colors.sub} />}
            {found && <Ionicons name="play-circle-outline" size={24} color={colors.sub} />}
          </Pressable>
        );
      }}
    />
  );
}
