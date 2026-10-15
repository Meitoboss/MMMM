import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { AlbumItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { Cover } from './components';
import { colors, useScheme } from './theme';

/** Home: the shortcuts at the top, two in a row – liked songs, offline songs, your playlists and bookmarked albums */
export function HomeQuickGrid() {
  useScheme();
  const router = useRouter();
  const [playlists, setPlaylists] = useState<repo.PlaylistRow[]>([]);
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      openDb()
        .then(async (db) => {
          const [lists, bookmarked] = await Promise.all([repo.playlists(db), repo.bookmarkedAlbums(db)]);
          if (!alive) return;
          setPlaylists(lists.slice(0, 4));
          setAlbums(bookmarked.slice(0, 4));
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );

  const tiles = [
    { key: 'liked', title: 'お気に入り', icon: 'heart' as const, go: () => router.push('/(tabs)/library') },
    { key: 'offline', title: 'オフライン', icon: 'arrow-down-circle' as const, go: () => router.push('/(tabs)/library') },
    ...playlists.map((p) => ({ key: `pl-${p.id}`, title: p.name, thumbnail: p.thumbnailUrl ?? undefined, go: () => router.push(`/local-playlist/${p.id}`) })),
    ...albums.map((a) => ({ key: `al-${a.id}`, title: a.title, thumbnail: a.thumbnail, go: () => router.push(`/album/${a.id}`) })),
  ];

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, marginBottom: 20 }}>
      {tiles.map((t) => (
        <Pressable key={t.key} onPress={t.go} style={{ width: '48.5%', flexDirection: 'row', alignItems: 'center', borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface2, height: 56 }}>
          {'thumbnail' in t && t.thumbnail ? (
            <Cover uri={t.thumbnail} size={56} />
          ) : (
            <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.border }}>
              <Ionicons name={'icon' in t ? t.icon : 'list'} size={22} color={colors.accentText} />
            </View>
          )}
          <Text numberOfLines={2} style={{ flex: 1, color: colors.text, fontSize: 13, fontWeight: '700', paddingHorizontal: 8 }}>
            {t.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
