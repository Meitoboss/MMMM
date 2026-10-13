import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { SongItem } from '../core/types';
import { getTasteMix } from '../state/taste';
import { usePlayer } from '../state/player';
import { SectionCarousel, s } from './components';
import { colors, useScheme } from './theme';

const TITLE = 'よく聴く曲からのおすすめ';
/** the same look as a shelf title */
const HEADING = { color: colors.text, fontSize: 18, fontWeight: '700' as const, paddingHorizontal: 16, marginBottom: 10 };

/** Home: songs like the ones you play most, as a shelf, and a button that plays them as a radio */
export function TasteShelf() {
  useScheme();
  const [songs, setSongs] = useState<SongItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    getTasteMix()
      .then((list) => alive && setSongs(list))
      .catch(() => alive && setSongs([]));
    return () => {
      alive = false;
    };
  }, []);

  if (songs === null) {
    return (
      <View style={{ marginBottom: 20 }}>
        <Text style={HEADING}>{TITLE}</Text>
        <Text style={[s.sub, { paddingHorizontal: 16 }]}>おすすめを作っています…</Text>
      </View>
    );
  }
  if (!songs.length) {
    return (
      <View style={{ marginBottom: 20 }}>
        <Text style={HEADING}>{TITLE}</Text>
        <Text style={[s.sub, { paddingHorizontal: 16 }]}>曲をよく聴くと、ここにおすすめが並びます。</Text>
      </View>
    );
  }
  return (
    <View>
      <SectionCarousel section={{ title: TITLE, items: songs }} />
      <Pressable onPress={() => void usePlayer.getState().playSongs(songs)} style={{ alignSelf: 'flex-start', marginLeft: 16, marginTop: -8, marginBottom: 20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.surface2 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>ラジオとして再生</Text>
      </Pressable>
    </View>
  );
}
