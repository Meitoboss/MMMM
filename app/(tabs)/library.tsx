import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { AlbumItem, ArtistItem, SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { chooseAndroidFolder, importLocalFiles, isAndroid, listInbox, savedAndroidFolder } from '../../src/player/localFiles';
import { useOffline } from '../../src/state/offline';
import { usePlayer } from '../../src/state/player';
import { Button, Cover, ItemRow, SongRow, s } from '../../src/ui/components';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

type Tab = 'songs' | 'local' | 'offline' | 'liked' | 'playlists' | 'albums' | 'artists' | 'history' | 'stats';
const TABS: { key: Tab; label: string }[] = [
  { key: 'songs', label: '曲' },
  { key: 'local', label: 'ローカル' },
  { key: 'offline', label: 'オフライン' },
  { key: 'liked', label: 'お気に入り' },
  { key: 'playlists', label: 'プレイリスト' },
  { key: 'albums', label: 'アルバム' },
  { key: 'artists', label: 'アーティスト' },
  { key: 'history', label: '履歴' },
  { key: 'stats', label: '統計' },
];
const RANGES: { key: repo.StatsRange; label: string }[] = [
  { key: 'today', label: '今日' }, { key: 'week', label: '週' }, { key: 'month', label: '月' },
  { key: '3months', label: '3か月' }, { key: '6months', label: '6か月' }, { key: 'year', label: '年' }, { key: 'all', label: '全期間' },
];

export default function Library() {
  const router = useRouter();
  useScheme();
  const play = usePlayer((p) => p.playSongs);
  const [tab, setTab] = useState<Tab>('songs');
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [playlists, setPlaylists] = useState<repo.PlaylistRow[]>([]);
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [artists, setArtists] = useState<ArtistItem[]>([]);
  const [top, setTop] = useState<repo.TopSong[]>([]);
  const [range, setRange] = useState<repo.StatsRange>('month');
  const [total, setTotal] = useState(0);
  const [newName, setNewName] = useState('');
  const [importing, setImporting] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [offlineBytes, setOfflineBytes] = useState(0);
  const jobs = useOffline((st) => st.jobs);
  const names = useOffline((st) => st.names);
  const offlineVersion = useOffline((st) => st.version);

  const load = useCallback(async () => {
    const db = await openDb();
    if (tab === 'songs') setSongs(await repo.allSongs(db));
    if (tab === 'local') {
      setSongs(await repo.localSongs(db));
      setWaiting((await listInbox()).length);
    }
    if (tab === 'offline') {
      setSongs(await repo.offlineSongs(db));
      setOfflineBytes(await repo.offlineTotalSize(db));
    }
    if (tab === 'liked') setSongs(await repo.likedSongs(db));
    if (tab === 'history') setSongs(await repo.history(db));
    if (tab === 'playlists') setPlaylists(await repo.playlists(db));
    if (tab === 'albums') setAlbums(await repo.bookmarkedAlbums(db));
    if (tab === 'artists') setArtists(await repo.bookmarkedArtists(db));
    if (tab === 'stats') {
      setTop(await repo.topSongs(db, range));
      setTotal(await repo.totalListeningMs(db, range));
    }
  }, [tab, range]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // a download finished / a copy was removed
  useEffect(() => {
    if (tab === 'offline') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineVersion]);

  const addFiles = async () => {
    setImporting(true);
    try {
      if (isAndroid && !savedAndroidFolder() && !(await chooseAndroidFolder())) return;
      const r = await importLocalFiles();
      await load();
      if (r.found === 0) {
        Alert.alert(
          '取り込む曲がありません',
          isAndroid
            ? '選んだフォルダに、新しい音楽ファイルがありません。別のフォルダを選ぶ場合は、「フォルダを選ぶ」を押してください。'
            : '「ファイル」アプリ → このiPhone内 → Music space → Music フォルダに、音楽ファイルを入れてから、もう一度押してください。',
        );
      } else if (r.failed.length) {
        Alert.alert(`${r.added.length}曲を取り込みました`, `取り込めなかったファイル:\n${r.failed.join('\n')}`);
      } else {
        Alert.alert(`${r.added.length}曲を取り込みました`);
      }
    } catch (e) {
      Alert.alert('取り込めませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const pickFolder = async () => {
    try {
      if (await chooseAndroidFolder()) await load();
    } catch (e) {
      Alert.alert('フォルダを選べませんでした', e instanceof Error ? e.message : String(e));
    }
  };

  const empty = (t: string) => <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>{t}</Text>;
  const pad = { paddingBottom: MINI_HEIGHT + 24 };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: tab === t.key ? colors.accent : colors.surface2 }}>
            <Text style={{ color: tab === t.key ? colors.onAccent : colors.text, fontWeight: tab === t.key ? '700' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {(tab === 'songs' || tab === 'local' || tab === 'offline' || tab === 'liked' || tab === 'history') && (
        <FlatList
          data={songs}
          keyExtractor={(x) => x.id}
          contentContainerStyle={pad}
          ListHeaderComponent={tab === 'local' || tab === 'offline' || songs.length ? (
            <View>
              {tab === 'local' && (
                <View style={{ paddingHorizontal: 16, marginBottom: 6, gap: 6 }}>
                  <Text style={s.sub}>
                    {isAndroid
                      ? '音楽が入っているフォルダを一度選ぶと、その中の曲（mp3、m4a、wav、flac など）をアプリにコピーして取り込みます。取り込んだ曲は、アプリの中に保存されます。曲を長押しすると、削除できます。'
                      : '「ファイル」アプリ → このiPhone内 → Music space → Music フォルダに、音楽ファイル（mp3、m4a、wav、flac など）を入れて、下の「取り込む」を押してください。取り込んだ曲は、アプリの中に保存されます。曲を長押しすると、削除できます。'}
                  </Text>
                  <Text style={{ color: waiting ? colors.accentText : colors.sub, fontWeight: '700' }}>
                    {isAndroid && !savedAndroidFolder() ? 'フォルダが未選択です' : `取り込み待ち: ${waiting}件`}
                  </Text>
                  <View style={{ flexDirection: 'row', marginBottom: songs.length ? 4 : 0 }}>
                    <Button label={importing ? '取り込み中…' : '取り込む'} icon="download-outline" onPress={() => { if (!importing) void addFiles(); }} />
                    {isAndroid && <View style={{ width: 8 }} />}
                    {isAndroid && <Button label={savedAndroidFolder() ? 'フォルダを変える' : 'フォルダを選ぶ'} icon="folder-open-outline" secondary onPress={() => void pickFolder()} />}
                  </View>
                </View>
              )}
              {tab === 'offline' && (
                <View style={{ paddingHorizontal: 16, marginBottom: 8, gap: 6 }}>
                  <Text style={s.sub}>
                    検索した曲などを、アプリの中に保存して、通信なしで聞けるようにします。保存した曲は、このアプリの中だけで再生できます。曲を長押しすると、保存を削除できます。
                  </Text>
                  <Text style={{ color: colors.accentText, fontWeight: '700' }}>
                    保存済み: {songs.length}曲 • {(offlineBytes / 1_000_000).toFixed(1)} MB
                  </Text>
                  {Object.entries(jobs).map(([id, j]) => (
                    <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: j.status === 'error' ? colors.danger : colors.text }} numberOfLines={1}>
                        {names[id] ?? id}
                      </Text>
                      <Text style={{ color: j.status === 'error' ? colors.danger : colors.sub, fontSize: 12 }} numberOfLines={1}>
                        {j.status === 'queued' ? '待機中' : j.status === 'downloading' ? `${Math.round(j.progress * 100)}%` : j.status === 'done' ? '完了' : (j.error ?? 'エラー').slice(0, 40)}
                      </Text>
                      <Pressable hitSlop={10} onPress={() => (j.status === 'error' || j.status === 'done' ? useOffline.getState().dismiss(id) : useOffline.getState().cancel(id))}>
                        <Ionicons name="close-circle-outline" size={20} color={colors.sub} />
                      </Pressable>
                    </View>
                  ))}
                  {!!songs.length && (
                    <View style={{ flexDirection: 'row' }}>
                      <Button
                        label="すべて削除"
                        icon="trash-outline"
                        secondary
                        onPress={() =>
                          Alert.alert('保存した曲を、すべて削除しますか？', '曲そのものは、ライブラリに残ります。', [
                            { text: '削除', style: 'destructive', onPress: () => void useOffline.getState().removeAll() },
                            { text: 'キャンセル', style: 'cancel' },
                          ])
                        }
                      />
                    </View>
                  )}
                </View>
              )}
              {!!songs.length && (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Button label="再生" icon="play" onPress={() => void play(songs, 0)} />
              <Button label="シャッフル" icon="shuffle" secondary onPress={() => { usePlayer.setState({ shuffle: true }); void play(songs, Math.floor(Math.random() * songs.length)); }} />
            </View>
              )}
            </View>
          ) : null}
          ListEmptyComponent={empty(tab === 'offline' ? 'まだ保存した曲がありません。曲の「…」から「オフラインに保存」を選ぶと、ここに並びます' : tab === 'local' ? (isAndroid ? 'まだ曲がありません。「フォルダを選ぶ」で音楽のフォルダを選んで、「取り込む」を押してください' : 'まだ曲がありません。Music フォルダに音楽ファイルを入れて、「取り込む」を押してください') : tab === 'liked' ? 'お気に入りはまだありません。曲を長押しして追加できます' : tab === 'history' ? 'まだ再生した曲がありません' : '再生した曲、お気に入り、プレイリストの曲がここに並びます')}
          renderItem={({ item, index }) => <SongRow song={item} onChanged={load} onPress={() => void play(songs, index)} />}
        />
      )}

      {tab === 'playlists' && (
        <FlatList
          data={playlists}
          keyExtractor={(x) => String(x.id)}
          contentContainerStyle={pad}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 }}>
              <TextInput value={newName} onChangeText={setNewName} placeholder="新しいプレイリスト名" placeholderTextColor={colors.sub}
                style={{ flex: 1, color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, height: 40 }} />
              <Button label="作成" onPress={async () => { if (!newName.trim()) return; await repo.createPlaylist(await openDb(), newName.trim()); setNewName(''); void load(); }} />
              <Button label="取り込み" secondary onPress={() => router.push('/import-playlist')} />
            </View>
          }
          ListEmptyComponent={empty('プレイリストがありません')}
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => router.push({ pathname: '/local-playlist/[id]', params: { id: String(item.id) } })}
              onLongPress={() => Alert.alert(item.name, undefined, [
                { text: '削除', style: 'destructive', onPress: async () => { await repo.deletePlaylist(await openDb(), item.id); void load(); } },
                { text: 'キャンセル', style: 'cancel' },
              ])}>
              {item.thumbnailUrl ? <Cover uri={item.thumbnailUrl} size={48} /> : <View style={{ width: 48, height: 48, borderRadius: 6, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="musical-notes" size={22} color={colors.sub} /></View>}
              <View style={s.rowText}>
                <Text style={s.title}>{item.name}</Text>
                <Text style={s.sub}>{item.songCount ?? 0}曲</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      {tab === 'albums' && <FlatList data={albums} keyExtractor={(x) => x.id} contentContainerStyle={pad} ListEmptyComponent={empty('アルバムのページでブックマークするとここに並びます')} renderItem={({ item }) => <ItemRow item={item} />} />}
      {tab === 'artists' && <FlatList data={artists} keyExtractor={(x) => x.id} contentContainerStyle={pad} ListEmptyComponent={empty('アーティストのページでブックマークするとここに並びます')} renderItem={({ item }) => <ItemRow item={item} />} />}

      {tab === 'stats' && (
        <FlatList
          data={top}
          keyExtractor={(x) => x.song.id}
          contentContainerStyle={pad}
          ListHeaderComponent={
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
                {RANGES.map((r) => (
                  <Pressable key={r.key} onPress={() => setRange(r.key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: range === r.key ? colors.accent : colors.surface2 }}>
                    <Text style={{ color: range === r.key ? colors.onAccent : colors.text, fontSize: 13 }}>{r.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={[s.h2, { marginTop: 16 }]}>再生時間: {repo.formatPlayTime(total)}</Text>
            </View>
          }
          ListEmptyComponent={empty('この期間の再生データがありません')}
          renderItem={({ item, index }) => (
            <SongRow song={item.song} index={index} onPress={() => void play(top.map((t) => t.song), index)}
              right={<Text style={{ color: colors.sub, fontSize: 12 }}>{repo.formatPlayTime(item.playTimeMs)}</Text>} />
          )}
        />
      )}
    </View>
  );
}
