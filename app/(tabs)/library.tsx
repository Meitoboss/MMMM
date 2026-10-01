import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { AlbumItem, ArtistItem, SongItem } from '../../src/core/types';
import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { usePlayer } from '../../src/state/player';
import { Button, Cover, ItemRow, SongRow, s } from '../../src/ui/components';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

type Tab = 'songs' | 'liked' | 'playlists' | 'albums' | 'artists' | 'history' | 'stats';
const TABS: { key: Tab; label: string }[] = [
  { key: 'songs', label: 'Songs' },
  { key: 'liked', label: 'Favorites' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'history', label: 'History' },
  { key: 'stats', label: 'Statistics' },
];
const RANGES: { key: repo.StatsRange; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' },
  { key: '3months', label: '3 months' }, { key: '6months', label: '6 months' }, { key: 'year', label: 'Year' }, { key: 'all', label: 'All' },
];

export default function Library() {
  const router = useRouter();
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

  const load = useCallback(async () => {
    const db = await openDb();
    if (tab === 'songs') setSongs(await repo.allSongs(db));
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

  const empty = (t: string) => <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>{t}</Text>;
  const pad = { paddingBottom: MINI_HEIGHT + 24 };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: tab === t.key ? colors.accent : colors.surface2 }}>
            <Text style={{ color: tab === t.key ? '#000' : colors.text }}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {(tab === 'songs' || tab === 'liked' || tab === 'history') && (
        <FlatList
          data={songs}
          keyExtractor={(x) => x.id}
          contentContainerStyle={pad}
          ListHeaderComponent={songs.length ? (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Button label="Play" icon="play" onPress={() => void play(songs, 0)} />
              <Button label="Shuffle" icon="shuffle" secondary onPress={() => { usePlayer.setState({ shuffle: true }); void play(songs, Math.floor(Math.random() * songs.length)); }} />
            </View>
          ) : null}
          ListEmptyComponent={empty(tab === 'liked' ? 'No favorites yet – long-press a song to like it' : tab === 'history' ? 'Nothing played yet' : 'Songs you play, like or add to playlists appear here')}
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
              <TextInput value={newName} onChangeText={setNewName} placeholder="New playlist name" placeholderTextColor={colors.sub}
                style={{ flex: 1, color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, height: 40 }} />
              <Button label="Create" onPress={async () => { if (!newName.trim()) return; await repo.createPlaylist(await openDb(), newName.trim()); setNewName(''); void load(); }} />
            </View>
          }
          ListEmptyComponent={empty('No playlists')}
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => router.push({ pathname: '/local-playlist/[id]', params: { id: String(item.id) } })}
              onLongPress={() => Alert.alert(item.name, undefined, [
                { text: 'Delete', style: 'destructive', onPress: async () => { await repo.deletePlaylist(await openDb(), item.id); void load(); } },
                { text: 'Cancel', style: 'cancel' },
              ])}>
              {item.thumbnailUrl ? <Cover uri={item.thumbnailUrl} size={48} /> : <View style={{ width: 48, height: 48, borderRadius: 6, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="musical-notes" size={22} color={colors.sub} /></View>}
              <View style={s.rowText}>
                <Text style={s.title}>{item.name}</Text>
                <Text style={s.sub}>{item.songCount ?? 0} songs</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      {tab === 'albums' && <FlatList data={albums} keyExtractor={(x) => x.id} contentContainerStyle={pad} ListEmptyComponent={empty('Bookmark albums from their page')} renderItem={({ item }) => <ItemRow item={item} />} />}
      {tab === 'artists' && <FlatList data={artists} keyExtractor={(x) => x.id} contentContainerStyle={pad} ListEmptyComponent={empty('Bookmark artists from their page')} renderItem={({ item }) => <ItemRow item={item} />} />}

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
                    <Text style={{ color: range === r.key ? '#000' : colors.text, fontSize: 13 }}>{r.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={[s.h2, { marginTop: 16 }]}>Listening time: {repo.formatPlayTime(total)}</Text>
            </View>
          }
          ListEmptyComponent={empty('No listening data for this period')}
          renderItem={({ item, index }) => (
            <SongRow song={item.song} index={index} onPress={() => void play(top.map((t) => t.song), index)}
              right={<Text style={{ color: colors.sub, fontSize: 12 }}>{repo.formatPlayTime(item.playTimeMs)}</Text>} />
          )}
        />
      )}
    </View>
  );
}
