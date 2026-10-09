import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { yt } from '../../src/core';
import { LiveSearch } from '../../src/core/liveSearch';
import { groupResults, toRows } from '../../src/core/searchGroups';
import type { ItemsPage, MusicItem, SearchFilter, SongItem } from '../../src/core/types';
import * as repo from '../../src/db/repo';
import { useOffline } from '../../src/state/offline';
import { ErrorView, ItemRow } from '../../src/ui/components';
import { useDb } from '../../src/ui/hooks';
import { MINI_HEIGHT, colors, dynamicStyles, useScheme } from '../../src/ui/theme';

const FILTERS: { label: string; value?: SearchFilter }[] = [
  { label: 'すべて' },
  { label: '曲', value: 'song' },
  { label: 'ビデオ', value: 'video' },
  { label: 'アルバム', value: 'album' },
  { label: 'アーティスト', value: 'artist' },
  { label: 'プレイリスト', value: 'community_playlist' },
  { label: 'おすすめ', value: 'featured_playlist' },
];

/** what the offline mode can narrow down to – only things that are on the device */
const OFFLINE_FILTERS: { label: string; value: repo.DownloadedKind }[] = [
  { label: 'すべて', value: 'all' },
  { label: '曲', value: 'audio' },
  { label: 'ビデオ', value: 'video' },
  { label: 'ローカル', value: 'local' },
];

type Mode = 'online' | 'offline';

/**
 * Online: YouTube Music, searching as you type. Offline: only what is saved on this device.
 * Typing → results (after a short pause). The list of suggestions is not touched while a finger is on it,
 * so that the row being tapped cannot be replaced under the finger.
 */
export default function Search() {
  useScheme();
  const db = useDb();
  const [mode, setMode] = useState<Mode>('online');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<SearchFilter | undefined>();
  const [offFilter, setOffFilter] = useState<repo.DownloadedKind>('all');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [items, setItems] = useState<MusicItem[]>([]);
  const [shown, setShown] = useState(''); // the text the results on screen belong to
  const [token, setToken] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [offItems, setOffItems] = useState<SongItem[]>([]);
  const offlineVersion = useOffline((s) => s.version);
  const touching = useRef(false);
  const pendingSuggestions = useRef<string[] | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const live = useRef<LiveSearch<ItemsPage<MusicItem>>>();
  live.current ??= new LiveSearch<ItemsPage<MusicItem>>({
    search: (q, f) => (f ? yt.search(q, f as SearchFilter) : yt.searchAll(q)),
    onStart: () => {
      setLoading(true);
      setError(undefined);
    },
    onResult: (q, _f, page) => {
      setItems(page.items);
      setToken(page.continuation);
      setShown(q);
      setLoading(false);
    },
    onError: (_q, _f, e) => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    },
    onClear: () => {
      setItems([]);
      setToken(undefined);
      setShown('');
      setError(undefined);
      setLoading(false);
    },
  });
  useEffect(() => () => live.current?.cancel(), []);

  const refreshHistory = () => {
    if (db) void repo.searchHistory(db).then(setHistory);
  };
  useEffect(refreshHistory, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  // every keystroke / filter change → a search after a short pause (online only)
  useEffect(() => {
    if (mode === 'online') live.current?.type(text, filter);
    else live.current?.cancel();
  }, [text, filter, mode]);

  // suggestions (YouTube Music), as a row of chips
  const applySuggestions = (list: string[]) => {
    if (touching.current) pendingSuggestions.current = list; // not while a finger is on the row
    else setSuggestions(list);
  };
  useEffect(() => {
    if (mode !== 'online' || !text.trim()) {
      setSuggestions([]);
      return;
    }
    const id = setTimeout(() => {
      yt.searchSuggestions(text).then((r) => applySuggestions(r.queries.slice(0, 8)), () => applySuggestions([]));
    }, 250);
    return () => clearTimeout(id);
  }, [text, mode]);
  const touchEnd = () => {
    setTimeout(() => {
      touching.current = false;
      if (pendingSuggestions.current) {
        setSuggestions(pendingSuggestions.current);
        pendingSuggestions.current = null;
      }
    }, 600);
  };

  // a search that is on the screen and was left alone for a moment goes into the history
  useEffect(() => {
    if (mode !== 'online' || !db) return;
    const q = text.trim();
    if (q.length < 2 || loading || error || !items.length || shown !== q) return;
    const id = setTimeout(() => void repo.addSearchQuery(db, q).then(refreshHistory), 1500);
    return () => clearTimeout(id);
  }, [items, loading, error, shown, text, mode, db]); // eslint-disable-line react-hooks/exhaustive-deps

  // offline: what is saved on the device, narrowed down by the text (instant, from the database)
  useEffect(() => {
    if (mode !== 'offline' || !db) return;
    let on = true;
    const id = setTimeout(() => void repo.searchDownloaded(db, text, offFilter).then((r) => on && setOffItems(r)), 120);
    return () => {
      on = false;
      clearTimeout(id);
    };
  }, [mode, text, offFilter, db, offlineVersion]);

  /** Enter, a tapped history entry or suggestion: search now and remember it */
  const pick = (q: string) => {
    Keyboard.dismiss();
    setText(q);
    if (db) void repo.addSearchQuery(db, q).then(refreshHistory);
    void live.current?.now(q, filterRef.current);
  };

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

  // The keyboard closes when anything other than the text box / the suggestions is touched, or a list is dragged.
  // (On release, never on touch-down: closing it earlier would move the list under the finger and the tap would be lost.)
  const dismiss = () => Keyboard.dismiss();
  const online = mode === 'online';
  const q = text.trim();
  const songs = items.filter((i): i is SongItem => i.kind === 'song');
  // "すべて": songs with songs, videos with videos, albums with albums … each block under its own heading
  const rows = useMemo(() => toRows(groupResults(items)), [items]);
  const noResults = !loading && shown === q && !items.length;

  const suggestionRow =
    online && suggestions.length > 0 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 8, alignItems: 'center' }}
        onTouchStart={() => (touching.current = true)}
        onTouchEnd={touchEnd}
        onTouchCancel={touchEnd}
        onScrollBeginDrag={() => (touching.current = true)}
        onScrollEndDrag={touchEnd}
      >
        {suggestions.map((sg) => (
          <Pressable key={sg} onPress={() => pick(sg)} style={st.suggestion}>
            <Ionicons name="search-outline" size={14} color={colors.sub} />
            <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>{sg}</Text>
          </Pressable>
        ))}
      </ScrollView>
    ) : null;

  const progress = loading && items.length ? <ActivityIndicator color={colors.accentText} style={{ margin: 10 }} /> : null;

  let body: React.ReactNode;
  if (!online) {
    body = (
      <FlatList
        data={offItems}
        keyExtractor={(it, i) => `${it.id}-${i}`}
        renderItem={({ item }) => <ItemRow item={item} context={offItems} />}
        contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onTouchEnd={dismiss}
        ListHeaderComponent={<Text style={[st.count]}>{offItems.length}曲</Text>}
        ListEmptyComponent={
          <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
            {q ? 'この条件に合う曲が、端末内にありません' : 'まだ、端末に保存した曲がありません。曲の「…」→「オフラインに保存」で、保存できます'}
          </Text>
        }
      />
    );
  } else if (!q) {
    body = (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onTouchEnd={dismiss}>
        {history.length > 0 && <Text style={st.count}>最近の検索（最大{repo.SEARCH_HISTORY_LIMIT}件）</Text>}
        {history.map((h) => (
          <Pressable key={h} onPress={() => pick(h)} style={st.hint}>
            <Ionicons name="time-outline" size={18} color={colors.sub} />
            <Text style={{ color: colors.text, flex: 1 }}>{h}</Text>
            <Pressable hitSlop={12} onPress={() => db && repo.deleteSearchQuery(db, h).then(refreshHistory)}>
              <Ionicons name="close" size={16} color={colors.sub} />
            </Pressable>
          </Pressable>
        ))}
        {history.length > 0 && db && (
          <Pressable onPress={() => repo.clearSearchHistory(db).then(refreshHistory)} style={{ padding: 16 }}>
            <Text style={{ color: colors.sub, textAlign: 'center' }}>履歴をすべて消す</Text>
          </Pressable>
        )}
        {!history.length && <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>文字を入れると、そのまま検索します</Text>}
      </ScrollView>
    );
  } else if (error) {
    body = (
      <View style={{ flex: 1 }}>
        {suggestionRow}
        <View style={{ flex: 1 }} onTouchEnd={dismiss}>
          <ErrorView message={error} onRetry={() => void live.current?.now(text, filter, true)} />
        </View>
      </View>
    );
  } else if (filter === undefined) {
    body = (
      <View style={{ flex: 1 }}>
        {suggestionRow}
        <FlatList
          data={rows}
          keyExtractor={(r, i) => (r.type === 'header' ? `h-${r.group.kind}` : `${r.item.kind}-${r.item.id}-${i}`)}
          renderItem={({ item: r }) =>
            r.type === 'header' ? (
              <Pressable
                onPress={() => {
                  setFilter(r.group.filter);
                  setItems([]);
                  void live.current?.now(text, r.group.filter);
                }}
                style={st.groupHeader}
              >
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>{r.group.label}</Text>
                <Text style={{ color: colors.accentText, fontWeight: '700' }}>すべて見る ›</Text>
              </Pressable>
            ) : (
              <ItemRow item={r.item} context={songs} />
            )
          }
          contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
          ListHeaderComponent={progress}
          ListFooterComponent={loading && !items.length ? <ActivityIndicator color={colors.accentText} style={{ margin: 16 }} /> : null}
          ListEmptyComponent={noResults ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>見つかりませんでした</Text> : null}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onTouchEnd={dismiss}
        />
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        {suggestionRow}
        <FlatList
          data={items}
          keyExtractor={(it, i) => `${it.kind}-${it.id}-${i}`}
          renderItem={({ item }) => <ItemRow item={item} context={songs} />}
          onEndReached={more}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
          ListHeaderComponent={progress}
          ListFooterComponent={loading && !items.length ? <ActivityIndicator color={colors.accentText} style={{ margin: 16 }} /> : null}
          ListEmptyComponent={noResults ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>見つかりませんでした</Text> : null}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onTouchEnd={dismiss}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={st.box}>
        <Pressable onPress={() => {
          if (text) {
            setText('');
            setItems([]);
            setToken(undefined);
            setShown('');
            setOffItems([]);
          }
        }} style={{ padding: 8 }}>
          <Ionicons name="search" size={18} color={colors.sub} />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => (online ? pick(text) : Keyboard.dismiss())}
          placeholder={online ? '曲、アルバム、アーティストを検索' : '端末に保存した曲を探す'}
          placeholderTextColor={colors.sub}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={st.input}
        />
        {!!text && (
          <Pressable hitSlop={10} onPress={() => setText('')}>
            <Ionicons name="close-circle" size={18} color={colors.sub} />
          </Pressable>
        )}
      </View>

      <View style={st.switch} onTouchEnd={dismiss}>
        {([['online', 'オンライン', 'cloud-outline'], ['offline', 'オフライン', 'download-outline']] as const).map(([m, label, icon]) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[st.switchSeg, mode === m && { backgroundColor: colors.accent }]}>
            <Ionicons name={icon} size={16} color={mode === m ? colors.onAccent : colors.sub} />
            <Text style={{ color: mode === m ? colors.onAccent : colors.sub, fontWeight: mode === m ? '800' : '600', fontSize: 14, lineHeight: 20 }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" onTouchEnd={dismiss} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 10, alignItems: 'center' }}>
        {online
          ? FILTERS.map((f) => (
              <Pressable
                key={f.label}
                onPress={() => {
                  setFilter(f.value);
                  setItems([]);
                  setToken(undefined);
                  void live.current?.now(text, f.value);
                }}
                style={[st.chip, filter === f.value && { backgroundColor: colors.accent }]}
              >
                <Text style={{ color: filter === f.value ? colors.onAccent : colors.text, fontWeight: filter === f.value ? '700' : '500', fontSize: 14, lineHeight: 20 }}>{f.label}</Text>
              </Pressable>
            ))
          : OFFLINE_FILTERS.map((f) => (
              <Pressable key={f.value} onPress={() => setOffFilter(f.value)} style={[st.chip, offFilter === f.value && { backgroundColor: colors.accent }]}>
                <Text style={{ color: offFilter === f.value ? colors.onAccent : colors.text, fontWeight: offFilter === f.value ? '700' : '500', fontSize: 14, lineHeight: 20 }}>{f.label}</Text>
              </Pressable>
            ))}
      </ScrollView>

      {body}
    </View>
  );
}

const st = dynamicStyles((c) => ({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface2, margin: 12, marginBottom: 8, paddingHorizontal: 14, height: 44, borderRadius: 22 },
  input: { flex: 1, color: c.text, fontSize: 16 },
  switch: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 8, padding: 3, borderRadius: 20, backgroundColor: c.surface2 },
  switchSeg: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, borderRadius: 17 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center', borderRadius: 18, backgroundColor: c.surface2 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  count: { color: c.sub, fontSize: 12, fontWeight: '700', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
}));
