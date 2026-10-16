import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { type MoodOption, TIME_OPTION, matchTagIds, nowHours, timeLabel } from '../../src/core/mood';
import type { SongItem } from '../../src/core/types';
import { focusHzOfSong, focusSongs, isFocusId } from '../../src/player/focus';
import { pauseTone, playTone } from '../../src/player/tone';
import { usePlayer } from '../../src/state/player';
import { useSettings } from '../../src/state/settings';
import { Button, SongRow, s } from '../../src/ui/components';
import { MoodDial } from '../../src/ui/MoodDial';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

/** how many songs are shown under the dial (the screen does not scroll; the buttons play all of them) */
const PREVIEW = 3;

/** 気分: a dial with the time of day and a few feelings – turn it, and the songs for that choice are played from here */
export default function MoodTab() {
  useScheme();
  const play = usePlayer((p) => p.playSongs);
  // the 集中 sounds are on while one of them is the song playing (or loading)
  const focusOn = usePlayer((p) => !!p.current && isFocusId(p.current.id) && (p.status === 'playing' || p.status === 'loading'));
  const [option, setOption] = useState<MoodOption>(TIME_OPTION);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [labels] = useState(() => ({ [TIME_OPTION.key]: timeLabel(new Date()) }));

  const load = useCallback(async (o: MoodOption) => {
    const db = await openDb();
    if (o.key === TIME_OPTION.key) {
      setSongs(await repo.playedInHours(db, nowHours(new Date()), 30));
      return;
    }
    const ids = matchTagIds(await repo.tags(db), o);
    setSongs(ids.length ? await repo.songsByTags(db, ids, 'any') : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(option);
    }, [load, option]),
  );

  // the sine tone follows the 集中 sounds: it plays while they play, and stops when they pause or another song starts
  useEffect(() => {
    let last = '';
    return usePlayer.subscribe((st) => {
      const focus = !!st.current && isFocusId(st.current.id);
      const key = `${focus}|${st.status}|${st.current?.id ?? ''}`;
      if (key === last) return;
      last = key;
      const { focusToneLevel } = useSettings.getState();
      if (focus && st.status === 'playing' && st.current && focusToneLevel !== 'off') {
        void playTone(focusHzOfSong(st.current.id) ?? 432, focusToneLevel);
      } else if (!focus || st.status === 'paused' || st.status === 'idle' || st.status === 'error' || focusToneLevel === 'off') {
        pauseTone();
      }
    });
  }, []);

  // a tap on the center: the 集中 sounds start (shuffled, never ending) or pause
  const toggleFocus = () => {
    const player = usePlayer.getState();
    if (focusOn) {
      void player.togglePlay();
      pauseTone();
      return;
    }
    const list = focusSongs();
    usePlayer.setState({ shuffle: true });
    player.setRepeat('all');
    void play(list, Math.floor(Math.random() * list.length));
  };

  const empty =
    option.key === TIME_OPTION.key
      ? 'この時間帯に聴いた曲は、まだありません'
      : `「${option.label}」のタグが付いた曲は、まだありません。曲の「…」からタグを付けると、ここに並びます`;

  return (
    // no scrolling on this screen: the dial takes the touches, and the songs are a short preview with the buttons for all of them
    <View style={{ flex: 1, alignItems: 'stretch', paddingTop: 16, paddingBottom: MINI_HEIGHT + 16, gap: 14, overflow: 'hidden' }}>
      <MoodDial labels={labels} focusOn={focusOn} onCenterPress={toggleFocus} onChange={(o) => { setOption(o); }} />
      <Text style={[s.sub, { textAlign: 'center', paddingHorizontal: 24 }]}>ダイヤルを回して、止めたところの気分を選びます。</Text>

      {songs.length ? (
        <>
          <Text style={{ color: colors.accentText, fontWeight: '700', textAlign: 'center' }}>{songs.length}曲</Text>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
            <Button label="再生" icon="play" onPress={() => void play(songs, 0)} />
            <Button label="シャッフル" icon="shuffle" secondary onPress={() => { usePlayer.setState({ shuffle: true }); void play(songs, Math.floor(Math.random() * songs.length)); }} />
          </View>
          {songs.slice(0, PREVIEW).map((song, i) => (
            <SongRow key={song.id} song={song} index={i} onPress={() => void play(songs, i)} />
          ))}
        </>
      ) : (
        <Text style={{ color: colors.sub, textAlign: 'center', paddingHorizontal: 24 }}>{empty}</Text>
      )}
    </View>
  );
}
