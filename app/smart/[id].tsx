import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { type Rule, type SmartRules, SMART_SORTS, describeRules, emptyRules } from '../../src/core/smart';
import type { SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { usePlayer } from '../../src/state/player';
import { Button, SongRow, s } from '../../src/ui/components';
import { showActionSheet } from '../../src/ui/dialogs';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

const digits = (text: string): number => Number(text.split('').filter((c) => c >= '0' && c <= '9').join('') || '0');

/** a row of exclusive choices */
function Seg<T extends string | boolean>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  useScheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? colors.accent : colors.surface2 }}>
            <Text style={{ color: on ? colors.onAccent : colors.text, fontWeight: on ? '700' : '500', fontSize: 13, lineHeight: 18 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function NumberField({ value, onChange, suffix }: { value: number; onChange: (n: number) => void; suffix: string }) {
  useScheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <TextInput
        value={String(value)}
        onChangeText={(t) => onChange(digits(t))}
        keyboardType="number-pad"
        style={{ minWidth: 64, color: colors.text, backgroundColor: colors.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, textAlign: 'center' }}
      />
      <Text style={s.sub}>{suffix}</Text>
    </View>
  );
}

function RuleEditor({ rule, tags, onChange, onRemove }: { rule: Rule; tags: repo.TagRow[]; onChange: (r: Rule) => void; onRemove: () => void }) {
  useScheme();
  const tagName = (id: number) => tags.find((t) => t.id === id)?.name ?? '（削除されたタグ）';
  let body: React.ReactNode = null;
  let label = '';
  switch (rule.field) {
    case 'liked':
      label = 'お気に入り';
      body = <Seg options={[{ label: 'お気に入り', value: true }, { label: 'お気に入りでない', value: false }]} value={rule.value} onChange={(value) => onChange({ field: 'liked', value })} />;
      break;
    case 'tag':
      label = 'タグ';
      body = (
        <View style={{ gap: 6 }}>
          <Seg options={[{ label: 'が付いている', value: 'has' as const }, { label: 'が付いていない', value: 'hasNot' as const }]} value={rule.op} onChange={(op) => onChange({ ...rule, op })} />
          <Pressable
            onPress={() =>
              showActionSheet({ options: [...tags.map((t) => t.name), 'キャンセル'], cancelButtonIndex: tags.length }, (i) => {
                if (i < tags.length) onChange({ ...rule, tagId: tags[i].id });
              })
            }
            style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.surface2 }}
          >
            <Text style={{ color: colors.accentText, fontWeight: '700' }}>{tagName(rule.tagId)} ▾</Text>
          </Pressable>
        </View>
      );
      break;
    case 'plays':
      label = '再生回数';
      body = (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <NumberField value={rule.value} onChange={(value) => onChange({ ...rule, value })} suffix="回" />
          <Seg options={[{ label: '以上', value: 'gte' as const }, { label: '以下', value: 'lte' as const }]} value={rule.op} onChange={(op) => onChange({ ...rule, op })} />
        </View>
      );
      break;
    case 'lastPlayed':
      label = '最後に聞いた日';
      body = (
        <View style={{ gap: 6 }}>
          <NumberField value={rule.days} onChange={(days) => onChange({ ...rule, days })} suffix="日" />
          <Seg options={[{ label: '以内に聞いた', value: 'within' as const }, { label: '以上聞いていない（聞いたことがない曲も含む）', value: 'notWithin' as const }]} value={rule.op} onChange={(op) => onChange({ ...rule, op })} />
        </View>
      );
      break;
    case 'artist':
    case 'title':
      label = rule.field === 'artist' ? 'アーティスト名に含む' : '曲名に含む';
      body = (
        <TextInput
          value={rule.value}
          onChangeText={(value) => onChange({ ...rule, value })}
          placeholder="文字を入力"
          placeholderTextColor={colors.sub}
          style={{ color: colors.text, backgroundColor: colors.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }}
        />
      );
      break;
    case 'bpm':
      label = 'BPM（テンポ）';
      body = (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <NumberField value={rule.min} onChange={(min) => onChange({ ...rule, min })} suffix="から" />
          <NumberField value={rule.max} onChange={(max) => onChange({ ...rule, max })} suffix="まで" />
        </View>
      );
      break;
    case 'source':
      label = '取得元';
      body = <Seg options={[{ label: 'YouTube', value: 'youtube' as const }, { label: '端末内の曲', value: 'local' as const }, { label: 'オフライン保存', value: 'offline' as const }]} value={rule.value} onChange={(value) => onChange({ field: 'source', value })} />;
      break;
  }
  return (
    <View style={[s.card, { padding: 12, gap: 8, marginBottom: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[s.title, { flex: 1 }]}>{label}</Text>
        <Pressable hitSlop={10} onPress={onRemove}><Ionicons name="close-circle" size={22} color={colors.sub} /></Pressable>
      </View>
      {body}
    </View>
  );
}

const ADDABLE: { label: string; make: (tags: repo.TagRow[]) => Rule | null }[] = [
  { label: 'お気に入り', make: () => ({ field: 'liked', value: true }) },
  { label: 'タグ', make: (tags) => (tags.length ? { field: 'tag', op: 'has', tagId: tags[0].id } : null) },
  { label: '再生回数', make: () => ({ field: 'plays', op: 'gte', value: 5 }) },
  { label: '最後に聞いた日', make: () => ({ field: 'lastPlayed', op: 'notWithin', days: 30 }) },
  { label: 'アーティスト名', make: () => ({ field: 'artist', value: '' }) },
  { label: '曲名', make: () => ({ field: 'title', value: '' }) },
  { label: 'BPM（テンポ）', make: () => ({ field: 'bpm', min: 120, max: 130 }) },
  { label: '取得元', make: () => ({ field: 'source', value: 'local' }) },
];

/** View, build and edit one smart playlist. `id` is "new" or the saved playlist's number. */
export default function SmartPlaylistScreen() {
  useScheme();
  const router = useRouter();
  const { id, tags: tagsParam, mode } = useLocalSearchParams<{ id: string; tags?: string; mode?: string }>();
  const isNew = id === 'new';
  const play = usePlayer((p) => p.playSongs);

  const [name, setName] = useState('');
  const [rules, setRules] = useState<SmartRules>(emptyRules());
  const [tags, setTags] = useState<repo.TagRow[]>([]);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [savedId, setSavedId] = useState<number | undefined>(isNew ? undefined : Number(id));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const db = await openDb();
      setTags(await repo.tags(db));
      if (!isNew) {
        const p = await repo.getSmartPlaylist(db, Number(id));
        if (p) {
          setName(p.name);
          setRules(p.rules);
        }
      } else if (tagsParam) {
        // opened from the Tags tab: start from the tags that were selected there
        const ids = String(tagsParam).split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0);
        setRules({ ...emptyRules(), match: mode === 'all' ? 'all' : 'any', rules: ids.map((tagId): Rule => ({ field: 'tag', op: 'has', tagId })) });
      }
      setLoaded(true);
    })();
  }, [id, isNew, tagsParam, mode]);

  // the preview follows every change of the rules
  useEffect(() => {
    if (!loaded) return;
    const h = setTimeout(() => {
      void openDb().then((db) => repo.smartSongs(db, rules)).then(setSongs);
    }, 250);
    return () => clearTimeout(h);
  }, [rules, loaded]);

  const setRule = (i: number, r: Rule) => setRules((cur) => ({ ...cur, rules: cur.rules.map((x, k) => (k === i ? r : x)) }));

  const addRule = () =>
    showActionSheet({ options: [...ADDABLE.map((a) => a.label), 'キャンセル'], cancelButtonIndex: ADDABLE.length }, (i) => {
      if (i >= ADDABLE.length) return;
      const r = ADDABLE[i].make(tags);
      if (!r) return Alert.alert('タグがありません', '曲のメニューの「タグを編集」で、先にタグを作ってください。');
      setRules((cur) => ({ ...cur, rules: [...cur.rules, r] }));
    });

  const save = async () => {
    try {
      const db = await openDb();
      const newId = await repo.saveSmartPlaylist(db, { id: savedId, name: name || 'スマートプレイリスト', rules });
      setSavedId(newId);
      Alert.alert('保存しました');
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    }
  };

  const remove = () =>
    Alert.alert('削除しますか？', '条件だけが消えます。曲は消えません。', [
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          if (savedId !== undefined) await repo.deleteSmartPlaylist(await openDb(), savedId);
          router.back();
        },
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);

  const header = (
    <View style={{ padding: 16, gap: 12 }}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="プレイリスト名"
        placeholderTextColor={colors.sub}
        style={{ color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 16 }}
      />
      <Text style={s.sub}>条件に合う曲が、開くたびに自動で集まります。</Text>

      <View style={{ gap: 6 }}>
        <Text style={s.title}>条件の組み合わせ</Text>
        <Seg options={[{ label: 'すべてに合う', value: 'all' as const }, { label: 'どれかに合う', value: 'any' as const }]} value={rules.match} onChange={(match) => setRules((c) => ({ ...c, match }))} />
      </View>

      <View>
        {rules.rules.map((r, i) => (
          <RuleEditor key={i} rule={r} tags={tags} onChange={(x) => setRule(i, x)} onRemove={() => setRules((c) => ({ ...c, rules: c.rules.filter((_, k) => k !== i) }))} />
        ))}
        {!rules.rules.length && <Text style={s.sub}>条件がありません（すべての曲が対象です）</Text>}
        <View style={{ flexDirection: 'row', marginTop: 6 }}>
          <Button label="条件を追加" icon="add" secondary onPress={addRule} />
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={s.title}>並び順</Text>
        <Seg options={SMART_SORTS} value={rules.sort} onChange={(sort) => setRules((c) => ({ ...c, sort }))} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={s.title}>最大</Text>
        <NumberField value={rules.limit} onChange={(limit) => setRules((c) => ({ ...c, limit: Math.max(1, limit) }))} suffix="曲まで" />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button label="保存" icon="save-outline" onPress={() => void save()} />
        {savedId !== undefined && <Button label="削除" icon="trash-outline" secondary onPress={remove} />}
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 }}>
        <Text style={{ color: colors.accentText, fontWeight: '800' }}>
          いまの結果: {songs.length}曲　<Text style={s.sub}>（{describeRules(rules, (tid) => tags.find((t) => t.id === tid)?.name ?? '？')}）</Text>
        </Text>
        {!!songs.length && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="再生" icon="play" onPress={() => void play(songs, 0)} />
            <Button label="シャッフル" icon="shuffle" secondary onPress={() => { usePlayer.setState({ shuffle: true }); void play(songs, 0); }} />
          </View>
        )}
      </View>
    </View>
  );

  return (
    <FlatList
      data={songs}
      keyExtractor={(x, i) => `${x.id}-${i}`}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 24 }}
      renderItem={({ item, index }) => <SongRow song={item} onPress={() => void play(songs, index)} />}
    />
  );
}
