import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import type { SongItem } from '../src/core/types';
import { ItemRow } from '../src/ui/components';
import { LIST_BOTTOM, colors, useScheme } from '../src/ui/theme';

export default function RecentSongsScreen() {
  useScheme();
  const [songs, setSongs] = useState<SongItem[]>([]);

  useEffect(() => {
    let alive = true;
    openDb()
      .then((db) => repo.recentSongs(db, 30))
      .then((rows) => alive && setSongs(rows))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={songs}
        keyExtractor={(it, i) => `${it.id}-${i}`}
        renderItem={({ item }) => <ItemRow item={item} context={songs} />}
        contentContainerStyle={{ paddingBottom: LIST_BOTTOM }}
      />
    </View>
  );
}
