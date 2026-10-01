import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import { useAddToPlaylist } from '../src/ui/actions';
import { Button, s } from '../src/ui/components';
import { colors } from '../src/ui/theme';

export default function AddToPlaylist() {
  const router = useRouter();
  const song = useAddToPlaylist((x) => x.song);
  const [lists, setLists] = useState<repo.PlaylistRow[]>([]);
  const [name, setName] = useState('');

  const load = async () => setLists(await repo.playlists(await openDb()));
  useEffect(() => { void load(); }, []);

  async function add(id: number) {
    if (!song) return;
    const n = await repo.addToPlaylist(await openDb(), id, [song]);
    if (n === 0) Alert.alert('Already in this playlist');
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', gap: 8, padding: 16 }}>
        <TextInput value={name} onChangeText={setName} placeholder="New playlist" placeholderTextColor={colors.sub}
          style={{ flex: 1, color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, height: 40 }} />
        <Button label="Create" onPress={async () => { if (!name.trim()) return; const id = await repo.createPlaylist(await openDb(), name.trim()); await add(id); }} />
      </View>
      <FlatList
        data={lists}
        keyExtractor={(x) => String(x.id)}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => void add(item.id)}>
            <View style={s.rowText}>
              <Text style={s.title}>{item.name}</Text>
              <Text style={s.sub}>{item.songCount ?? 0} songs</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
