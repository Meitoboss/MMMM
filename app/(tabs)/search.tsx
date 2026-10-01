import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { yt } from '../../src/core';
import type { MusicItem, SearchFilter, SongItem } from '../../src/core/types';
import * as repo from '../../src/db/repo';
import { ErrorView, ItemRow } from '../../src/ui/components';
import { useDb } from '../../src/ui/hooks';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

const FILTERS: { label: string; value?: SearchFilter }[] = [
  { label: 'All' },
  { label: 'Songs', value: 'song' },
  { label: 'Videos', value: 'video' },
  { label: 'Albums', value: 'album' },
  { label: 'Artists', value: 'artist' },
  { label: 'Playlists', value: 'community_playlist' },
  { label: 'Featured', value: 'featured_playlist' },
];

export default function Search() {
  const db = useDb();
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState<string>();
  const [filter, setFilter] = useState<SearchFilter | undefined>();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [items, setItems] = useState<MusicItem[]>([]);
  const [token, setToken] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const seq = useRef(0);

  // history (local) + suggestions (YouTube Music), debounced
  useEffect(() => {
    if (!db) return;
    void repo.searchHistory(db, text, 8).then(setHistory);
    if (!text.trim()) return setSuggestions([]);
    const id = setTimeout(() => {
      yt.searchSuggestions(text).then((r) => setSuggestions(r.queries.slice(0, 8)), () => setSuggestions([]));
    }, 250);
    return () => clearTimeout(id);
  }, [text, db, submitted]);

  async function run(q: string, f: SearchFilter | undefined) {
    const query = q.trim();
    if (!query) return;
    Keyboard.dismiss();
    const my = ++seq.current;
    setText(query);
    setSubmitted(query);
    setLoading(true);
    setError(undefined);
    setItems([]);
    setToken(undefined);
    try {
      if (db) await repo.addSearchQuery(db, query);
      const page = await yt.search(query, f);
      if (my !== seq.current) return;
      setItems(page.items);
      setToken(page.continuation);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }

  async function more() {
    if (!token || loading) return;
    setLoading(true);
    try {
      const page = await yt.searchContinuation(token);
      setItems((cur) => [...cur, ...page.items.filter((n) => !cur.some((c) => c.kind === n.kind && c.id === n.id))]);
      setToken(page.continuation);
    } catch {
      setToken(undefined);
    } finally {
      setLoading(false);
    }
  }

  const showHints = !submitted || text !== submitted;
  const songs = items.filter((i): i is SongItem => i.kind === 'song');

  return (
    <View style={{ flex: 1 }}>
      <View style={st.box}>
        <Ionicons name="search" size={18} color={colors.sub} />
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => run(text, filter)}
          placeholder="Songs, albums, artists…"
          placeholderTextColor={colors.sub}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={st.input}
        />
        {!!text && (
          <Pressable onPress={() => { setText(''); setSubmitted(undefined); setItems([]); }}>
            <Ionicons name="close-circle" size={18} color={colors.sub} />
          </Pressable>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 8 }}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.label}
            onPress={() => { setFilter(f.value); if (submitted) void run(submitted, f.value); }}
            style={[st.chip, filter === f.value && { backgroundColor: colors.accent }]}
          >
            <Text style={{ color: filter === f.value ? '#000' : colors.text }}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {showHints ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          {[...history.map((h) => ({ h, past: true })), ...suggestions.filter((x) => !history.includes(x)).map((h) => ({ h, past: false }))].map(({ h, past }) => (
            <Pressable key={`${past}-${h}`} onPress={() => run(h, filter)} style={st.hint}>
              <Ionicons name={past ? 'time-outline' : 'search-outline'} size={18} color={colors.sub} />
              <Text style={{ color: colors.text, flex: 1 }}>{h}</Text>
              {past && db && (
                <Pressable hitSlop={10} onPress={() => repo.deleteSearchQuery(db, h).then(() => repo.searchHistory(db, text, 8).then(setHistory))}>
                  <Ionicons name="close" size={16} color={colors.sub} />
                </Pressable>
              )}
            </Pressable>
          ))}
        </ScrollView>
      ) : error ? (
        <ErrorView message={error} onRetry={() => run(text, filter)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it, i) => `${it.kind}-${it.id}-${i}`}
          renderItem={({ item }) => <ItemRow item={item} context={songs} />}
          onEndReached={more}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
          ListFooterComponent={loading ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} /> : null}
          ListEmptyComponent={!loading ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>No results</Text> : null}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface2, margin: 12, paddingHorizontal: 12, height: 42, borderRadius: 21 },
  input: { flex: 1, color: colors.text, fontSize: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.surface2 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
});
