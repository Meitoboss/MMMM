import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { decodeSong } from '../src/core/songParam';
import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import { Button, s } from '../src/ui/components';
import { promptText, showActionSheet } from '../src/ui/dialogs';
import { colors, useScheme } from '../src/ui/theme';

/** Put tags on one song; make new tags; rename / delete them (long-press). */
export default function SongTags() {
  useScheme();
  const params = useLocalSearchParams<{ song?: string }>();
  const song = useMemo(() => decodeSong(params.song), [params.song]);
  const [tags, setTags] = useState<repo.TagRow[]>([]);
  const [on, setOn] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');

  const reload = useCallback(async () => {
    const db = await openDb();
    setTags(await repo.tags(db));
    if (song) setOn(new Set(await repo.tagIdsOfSong(db, song.id)));
  }, [song]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const fail = (title: string, e: unknown) => Alert.alert(title, e instanceof Error ? e.message : String(e));

  const toggle = async (id: number) => {
    if (!song) return;
    try {
      await repo.setSongTag(await openDb(), song, id, !on.has(id));
      await reload();
    } catch (e) {
      fail('変更できませんでした', e);
    }
  };

  const create = async () => {
    try {
      const db = await openDb();
      const id = await repo.createTag(db, name);
      setName('');
      if (song) await repo.setSongTag(db, song, id, true);
      await reload();
    } catch (e) {
      fail('作成できませんでした', e);
    }
  };

  const manage = (t: repo.TagRow) =>
    showActionSheet({ title: t.name, message: `${t.songCount}曲`, options: ['名前を変更', '削除', 'キャンセル'], destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (i) => {
      if (i === 0) {
        promptText('タグの名前を変更', undefined, t.name, async (v) => {
          try {
            await repo.renameTag(await openDb(), t.id, v);
            await reload();
          } catch (e) {
            fail('変更できませんでした', e);
          }
        });
      } else if (i === 1) {
        Alert.alert(`「${t.name}」を削除しますか？`, 'このタグが付いた曲から、タグが外れます。曲は消えません。', [
          { text: '削除', style: 'destructive', onPress: async () => { await repo.deleteTag(await openDb(), t.id); await reload(); } },
          { text: 'キャンセル', style: 'cancel' },
        ]);
      }
    });

  if (!song) return <View style={s.center}><Text style={s.sub}>曲の情報を読み取れませんでした</Text></View>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={s.title} numberOfLines={1}>{song.title}</Text>
        <Text style={s.sub} numberOfLines={1}>{song.artists.map((a) => a.name).join(', ')}</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tags.map((t) => {
          const selected = on.has(t.id);
          return (
            <Pressable
              key={t.id}
              onPress={() => void toggle(t.id)}
              onLongPress={() => manage(t)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center', borderRadius: 18, backgroundColor: selected ? colors.accent : colors.surface2 }}
            >
              <Text style={{ color: selected ? colors.onAccent : colors.text, fontWeight: selected ? '700' : '500', fontSize: 14, lineHeight: 20 }}>
                {selected ? '✓ ' : ''}{t.name} · {t.songCount}
              </Text>
            </Pressable>
          );
        })}
        {!tags.length && <Text style={s.sub}>まだタグがありません。下で作ってください。</Text>}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="新しいタグ（例: 作業用、雨の日）"
          placeholderTextColor={colors.sub}
          maxLength={30}
          onSubmitEditing={() => void create()}
          style={{ flex: 1, color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, height: 44 }}
        />
        <Button label="作成" onPress={() => void create()} />
      </View>

      <Text style={s.sub}>
        タップで、この曲に付けたり外したりします。タグを長押しすると、名前の変更と削除ができます。
        ライブラリの「タグ」では、タグを組み合わせて、まとめて再生できます。
      </Text>
    </ScrollView>
  );
}
