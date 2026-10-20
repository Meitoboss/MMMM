import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { openDb } from '../../src/db/expo';
import * as repo from '../../src/db/repo';
import { DIAL_OPTIONS, type MoodOption, TIME_OPTION, matchTagIds, nowHours, timeLabel } from '../../src/core/mood';
import type { SongItem } from '../../src/core/types';
import { focusHzOfSong, focusSongs, isFocusId } from '../../src/player/focus';
import { pauseTone, playTone, setTestEars, testEars } from '../../src/player/tone';
import { usePlayer } from '../../src/state/player';
import { useSettings } from '../../src/state/settings';
import { Button, SongRow } from '../../src/ui/components';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';

/** the pitch of each ear of the 集中 tone, changed on the spot while the 集中 sounds play (developer) */
function EarHz({ ears, onChange }: { ears: { left: number; right: number }; onChange: (next: { left: number; right: number }) => void }) {
  const move = (side: 'left' | 'right', step: number) => {
    const next = { ...ears, [side]: Math.min(500, Math.max(20, ears[side] + step)) };
    setTestEars(next.left, next.right);
    onChange(next);
  };
  const button = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surface2 }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  const ear = (name: string, side: 'left' | 'right') => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: colors.sub, fontSize: 12 }}>{name}</Text>
      {button('−', () => move(side, -5))}
      <Text style={{ color: colors.text, fontWeight: '700', minWidth: 60, textAlign: 'center' }}>{ears[side]} Hz</Text>
      {button('+', () => move(side, 5))}
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 14, paddingHorizontal: 12 }}>
      {ear('左', 'left')}
      {ear('右', 'right')}
    </View>
  );
}

/** the title of a section */
const SECTION_TITLE = { color: colors.text, fontSize: 18, fontWeight: '800' } as const;

/** 気分: the 集中 sounds as a card (the Hz is the difference between the ears), and the songs of the chosen mood below */
export default function MoodTab() {
  useScheme();
  const play = usePlayer((p) => p.playSongs);
  // the 集中 sounds are on while one of them is the song playing (or loading)
  const focusOn = usePlayer((p) => !!p.current && isFocusId(p.current.id) && (p.status === 'playing' || p.status === 'loading'));
  const [option, setOption] = useState<MoodOption>(TIME_OPTION);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [labels] = useState(() => ({ [TIME_OPTION.key]: timeLabel(new Date()) }));
  const [ears, setEars] = useState(testEars);

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
        void playTone(focusHzOfSong(st.current.id) ?? 432);
      } else if (!focus || st.status === 'paused' || st.status === 'idle' || st.status === 'error' || focusToneLevel === 'off') {
        pauseTone();
      }
    });
  }, []);

  // a tap on the card: the 集中 sounds start (shuffled, never ending) or pause
  const toggleFocus = () => {
    const player = usePlayer.getState();
    if (focusOn) {
      void player.togglePlay();
      pauseTone();
      return;
    }
    const list = focusSongs();
    if (!list.length) return; // no focus sounds on the server yet
    usePlayer.setState({ shuffle: true });
    player.setRepeat('all');
    void play(list, Math.floor(Math.random() * list.length));
  };

  const empty =
    option.key === TIME_OPTION.key
      ? 'この時間帯に聴いた曲は、まだありません'
      : `「${option.label}」のタグが付いた曲は、まだありません。曲の「…」からタグを付けると、ここに並びます`;
  const beat = ears.right - ears.left;

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: MINI_HEIGHT + 24, gap: 22 }}>
      {/* the moods: choose one, and the songs for it are listed below */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {DIAL_OPTIONS.map((o) => {
          const on = o.key === option.key;
          return (
            <Pressable
              key={o.key}
              onPress={() => setOption(o)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: on ? colors.accent : colors.surface2 }}
            >
              <Text style={{ color: on ? colors.onAccent : colors.text, fontWeight: on ? '700' : '500' }}>{labels[o.key] ?? o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 集中: the card of the 集中 sounds, with the Hz (the difference between the ears) in large */}
      <View style={{ gap: 12, paddingHorizontal: 16 }}>
        <Text style={SECTION_TITLE}>集中</Text>
        <Pressable
          onPress={toggleFocus}
          accessibilityRole="button"
          style={{ borderRadius: 22, backgroundColor: colors.accent, padding: 20, minHeight: 170, justifyContent: 'space-between' }}
        >
          <Text style={{ color: colors.onAccent, fontSize: 56, fontWeight: '200' }}>{beat} Hz</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: colors.onAccent, fontSize: 18, fontWeight: '700' }}>広い野原</Text>
              <Text style={{ color: colors.onAccent, opacity: 0.8, fontSize: 12 }}>集中 ・ ミュージック</Text>
            </View>
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{focusOn ? '止める' : '再生'}</Text>
          </View>
        </Pressable>
        {focusOn && <EarHz ears={ears} onChange={setEars} />}
      </View>

      {/* the songs of the chosen mood */}
      <View style={{ gap: 12 }}>
        <Text style={[SECTION_TITLE, { paddingHorizontal: 16 }]}>{labels[option.key] ?? option.label}</Text>
        {songs.length ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Button label="再生" icon="play" onPress={() => void play(songs, 0)} />
              <Button label="シャッフル" icon="shuffle" secondary onPress={() => { usePlayer.setState({ shuffle: true }); void play(songs, Math.floor(Math.random() * songs.length)); }} />
            </View>
            {songs.map((song, i) => (
              <SongRow key={song.id} song={song} index={i} onPress={() => void play(songs, i)} />
            ))}
          </>
        ) : (
          <Text style={{ color: colors.sub, paddingHorizontal: 16 }}>{empty}</Text>
        )}
      </View>
    </ScrollView>
  );
}
