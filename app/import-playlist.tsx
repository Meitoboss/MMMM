import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { yt } from '../src/core';
import { type MatchResult, matchAll, parseTrackList } from '../src/core/importer';
import type { SongItem } from '../src/core/types';
import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import { Button, s } from '../src/ui/components';
import { showActionSheet } from '../src/ui/dialogs';
import { colors, useScheme } from '../src/ui/theme';

const MAX_TRACKS = 300;

const artistText = (song: SongItem) => song.artists.map((a) => a.name).join(', ');

/** Turn a list of tracks (CSV or plain lines) into a playlist of YouTube Music songs. */
export default function ImportPlaylist() {
  useScheme();
  const router = useRouter();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'input' | 'running' | 'review'>('input');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<MatchResult[]>([]);
  /** the song chosen for each row (null = leave it out) */
  const [chosen, setChosen] = useState<(SongItem | null)[]>([]);
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false);

  const tracks = useMemo(() => parseTrackList(text), [text]);
  useEffect(() => () => void (cancelled.current = true), []);

  const start = async () => {
    const list = tracks.slice(0, MAX_TRACKS);
    if (!list.length) return;
    cancelled.current = false;
    setProgress({ done: 0, total: list.length });
    setPhase('running');
    const res = await matchAll(list, async (q) => (await yt.search(q, 'song')).items, {
      concurrency: 3,
      delayMs: 150,
      isCancelled: () => cancelled.current,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    setResults(res);
    setChosen(res.map((r) => (r.status === 'matched' ? (r.best ?? null) : null)));
    setPhase('review');
  };

  const counts = useMemo(() => {
    const c = { matched: 0, maybe: 0, none: 0 };
    for (const r of results) c[r.status] += 1;
    return c;
  }, [results]);
  const selected = chosen.filter((x): x is SongItem => !!x);

  const pick = (index: number) => {
    const r = results[index];
    if (!r.candidates.length) return;
    const labels = r.candidates.map((c) => `${c.song.title} / ${artistText(c.song)}${c.song.durationText ? `  ${c.song.durationText}` : ''}`);
    showActionSheet(
      { title: r.track.title, message: r.track.artist, options: [...labels, 'この曲は入れない', 'キャンセル'], destructiveButtonIndex: labels.length, cancelButtonIndex: labels.length + 1 },
      (i) => {
        if (i === labels.length + 1) return;
        setChosen((cur) => cur.map((x, k) => (k === index ? (i === labels.length ? null : r.candidates[i].song) : x)));
      },
    );
  };

  const toggle = (index: number) => {
    const r = results[index];
    if (!r.best) return;
    setChosen((cur) => cur.map((x, k) => (k === index ? (x ? null : (r.best ?? null)) : x)));
  };

  const create = async () => {
    if (!selected.length || saving) return;
    setSaving(true);
    try {
      const db = await openDb();
      const id = await repo.createPlaylist(db, name.trim() || 'インポートしたプレイリスト');
      await repo.addToPlaylist(db, id, selected);
      router.replace({ pathname: '/local-playlist/[id]', params: { id: String(id) } });
    } catch (e) {
      Alert.alert('作成できませんでした', e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  /* ------------------------------ 1. paste ------------------------------ */
  if (phase === 'input') {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={s.sub}>
          Spotifyなどのプレイリストの曲を貼り付けると、YouTube Musicで同じ曲を探して、プレイリストを作ります。
          曲のデータそのものは、取り込みません。
        </Text>
        <View style={[s.card, { padding: 12, gap: 4 }]}>
          <Text style={s.title}>貼り付けられる形式</Text>
          <Text style={s.sub}>• CSV（Spotifyのプレイリストを書き出すツールの出力など。「Track Name」「Artist Name(s)」などの列を読み取ります）</Text>
          <Text style={s.sub}>• 1行に1曲の文字（「アーティスト - 曲名」や、曲名だけ）</Text>
          <Text style={s.sub}>• 最大{MAX_TRACKS}曲まで</Text>
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="プレイリスト名"
          placeholderTextColor={colors.sub}
          style={{ color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, height: 44 }}
        />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={'ここに貼り付け\n例:\nKing Gnu - AIZO\nOfficial髭男dism - Pretender'}
          placeholderTextColor={colors.sub}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
          textAlignVertical="top"
          style={{ color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, padding: 12, minHeight: 220, maxHeight: 360 }}
        />
        <Text style={{ color: tracks.length ? colors.accentText : colors.sub, fontWeight: '700' }}>
          {tracks.length ? `${tracks.length}曲を読み取りました${tracks.length > MAX_TRACKS ? `（先頭の${MAX_TRACKS}曲だけ使います）` : ''}` : '曲が読み取れていません'}
        </Text>
        <View style={{ flexDirection: 'row' }}>
          <Button label="曲を探す" icon="search" onPress={() => void start()} />
        </View>
      </ScrollView>
    );
  }

  /* ------------------------------ 2. searching ------------------------------ */
  if (phase === 'running') {
    const pct = progress.total ? progress.done / progress.total : 0;
    return (
      <View style={[s.center, { gap: 14 }]}>
        <Text style={s.h1}>曲を探しています</Text>
        <Text style={s.sub}>{progress.done} / {progress.total} 曲</Text>
        <View style={{ width: '80%', height: 8, borderRadius: 4, backgroundColor: colors.surface2 }}>
          <View style={{ width: `${pct * 100}%`, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
        </View>
        <Button label="ここで止めて結果を見る" secondary onPress={() => (cancelled.current = true)} />
      </View>
    );
  }

  /* ------------------------------ 3. review ------------------------------ */
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 2 }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>
          一致 {counts.matched}　•　要確認 {counts.maybe}　•　見つからず {counts.none}
        </Text>
        <Text style={s.sub}>行をタップで、入れる／入れないを切り替えます。「要確認」と「見つからず」は、右のボタンで候補から選べます。</Text>
      </View>
      <FlatList
        data={results}
        keyExtractor={(r, i) => `${i}-${r.track.raw}`}
        contentContainerStyle={{ paddingBottom: 110 }}
        renderItem={({ item, index }) => {
          const song = chosen[index];
          const icon = item.status === 'matched' ? 'checkmark-circle' : item.status === 'maybe' ? 'help-circle' : 'close-circle';
          const iconColor = item.status === 'matched' ? colors.accentText : item.status === 'maybe' ? colors.text : colors.danger;
          return (
            <Pressable style={[s.row, { opacity: song ? 1 : 0.55 }]} onPress={() => toggle(index)}>
              <Ionicons name={song ? 'checkbox' : 'square-outline'} size={22} color={song ? colors.accentText : colors.sub} />
              <View style={s.rowText}>
                <Text style={s.title} numberOfLines={1}>{item.track.title}{item.track.artist ? ` – ${item.track.artist}` : ''}</Text>
                <Text style={[s.sub, { color: song ? colors.accentText : colors.sub }]} numberOfLines={1}>
                  {song ? `→ ${song.title} / ${artistText(song)}` : item.best ? '入れない（タップで入れる）' : item.error ? `エラー: ${item.error}` : '見つかりませんでした'}
                </Text>
              </View>
              <Ionicons name={icon} size={18} color={iconColor} />
              {item.candidates.length > 0 && (
                <Pressable hitSlop={10} onPress={() => pick(index)}>
                  <Ionicons name="swap-horizontal" size={22} color={colors.text} />
                </Pressable>
              )}
            </Pressable>
          );
        }}
      />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', gap: 8 }}>
        <Button label="やり直す" secondary onPress={() => setPhase('input')} />
        <Button label={saving ? '作成中…' : `プレイリストを作成（${selected.length}曲）`} icon="add-circle-outline" onPress={() => void create()} />
      </View>
    </View>
  );
}
