import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { formatBytes } from '../src/core/songArchive';
import { filterItems, summary } from '../src/core/songPick';
import { archivePick, useArchivePick } from '../src/state/archivePick';
import { colors, useScheme } from '../src/ui/theme';

/** Settings → 保存した曲のバックアップ → ファイルに入れる: which saved songs go into the file (everything is chosen at first) */
export default function ArchivePick() {
  useScheme();
  const router = useRouter();
  const items = useArchivePick((s) => s.items);
  const selected = useArchivePick((s) => s.selected);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterItems(items, query), [items, query]);
  const sum = summary(items, selected);
  const searching = query.trim().length > 0;

  // leaving the screen any way but "決定" (back, swipe) is "やめる": nothing is exported (after "決定" this does nothing)
  useEffect(() => () => archivePick.cancel(), []);

  const button = (label: string, onPress: () => void, testID: string, primary = false) => (
    <Pressable testID={testID} onPress={onPress} style={{ flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center', backgroundColor: primary ? colors.accent : colors.surface2 }}>
      <Text style={{ color: primary ? colors.onAccent : colors.text, fontWeight: '800', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View testID="pick-screen" style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 16, gap: 10 }}>
        <Text testID="pick-summary" style={{ color: colors.accentText, fontWeight: '800', fontSize: 15 }}>
          選んだ曲: {sum.count} / {items.length}曲（{formatBytes(sum.bytes)}）
        </Text>
        <TextInput
          testID="pick-search"
          value={query}
          onChangeText={setQuery}
          placeholder="曲名・アーティストで絞り込む"
          placeholderTextColor={colors.sub}
          style={{ color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, height: 40 }}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {button(searching ? '表示中を選ぶ' : 'すべて選ぶ', () => archivePick.setMany(shown.map((i) => i.id), true), 'pick-all')}
          {button(searching ? '表示中を外す' : 'すべて外す', () => archivePick.setMany(shown.map((i) => i.id), false), 'pick-none')}
        </View>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<Text style={{ color: colors.sub, textAlign: 'center', marginTop: 30 }}>{items.length ? '見つかりません' : '保存した曲がありません'}</Text>}
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable testID={`pick-${item.id}`} accessibilityState={{ checked: on }} onPress={() => archivePick.toggle(item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={26} color={on ? colors.accentText : colors.sub} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: colors.sub, fontSize: 12 }} numberOfLines={1}>{item.artist || '—'}</Text>
              </View>
              <Text style={{ color: colors.sub, fontSize: 12 }}>{formatBytes(item.bytes)}</Text>
            </Pressable>
          );
        }}
      />
      <View style={{ flexDirection: 'row', gap: 12, padding: 16 }}>
        {button('やめる', () => { archivePick.cancel(); router.back(); }, 'pick-cancel')}
        {button(`決定（${sum.count}曲）`, () => { archivePick.confirm(); router.back(); }, 'pick-confirm', true)}
      </View>
    </View>
  );
}
