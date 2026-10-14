import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { FORGOTTEN_AFTER_MS, PART_OF_DAY_HOURS, PART_OF_DAY_LABEL, partOfDay, sameDayBefore } from '../core/homeMemory';
import type { SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { SectionCarousel, s } from './components';
import { Chips } from './SettingsParts';
import { colors, useScheme } from './theme';

/** Home: the songs played on this calendar day in earlier years ("この日に聴いた曲"). Hidden when there are none. */
export function OnThisDayShelf() {
  useScheme();
  const [songs, setSongs] = useState<SongItem[]>([]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      openDb()
        .then((db) => repo.playedBetween(db, sameDayBefore(new Date(), [1, 2, 3, 4, 5])))
        .then((list) => alive && setSongs(list))
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );
  if (!songs.length) return null;
  return <SectionCarousel section={{ title: 'この日に聴いた曲', items: songs }} />;
}

/** Home: liked songs you have not played for a month ("久しぶりのお気に入り"). Hidden when there are none. */
export function ForgottenShelf() {
  useScheme();
  const [songs, setSongs] = useState<SongItem[]>([]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      openDb()
        .then((db) => repo.forgottenLikes(db, Date.now() - FORGOTTEN_AFTER_MS))
        .then((list) => alive && setSongs(list))
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );
  if (!songs.length) return null;
  return <SectionCarousel section={{ title: '久しぶりのお気に入り', items: songs }} />;
}

/**
 * Home: "今の時間によく聴く曲" and the songs of your own tags, picked with chips. The chip choice is kept while the app runs.
 */
export function TimeMoodShelf() {
  useScheme();
  const [part] = useState(() => partOfDay(new Date().getHours()));
  const [pick, setPick] = useState<string>('time');
  const [tags, setTags] = useState<{ id: number; name: string; songCount: number }[]>([]);
  const [songs, setSongs] = useState<SongItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      openDb()
        .then((db) => repo.tags(db))
        .then((list) => alive && setTags(list.filter((t) => t.songCount > 0).slice(0, 5)))
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );

  useEffect(() => {
    let alive = true;
    const load = pick === 'time' ? openDb().then((db) => repo.playedInHours(db, PART_OF_DAY_HOURS[part])) : openDb().then((db) => repo.songsByTags(db, [Number(pick)], 'any'));
    load.then((list) => alive && setSongs(list)).catch(() => alive && setSongs([]));
    return () => {
      alive = false;
    };
  }, [pick, part]);

  const options = [{ label: `今（${PART_OF_DAY_LABEL[part]}）`, value: 'time' }, ...tags.map((t) => ({ label: t.name, value: String(t.id) }))];
  const current = options.find((o) => o.value === pick)?.label ?? '';
  const title = pick === 'time' ? `${PART_OF_DAY_LABEL[part]}によく聴く曲` : `「${current}」の曲`;

  return (
    <View style={{ marginBottom: 8 }}>
      <Chips options={options} value={pick} onChange={(v) => setPick(v ?? 'time')} />
      {songs.length ? (
        <SectionCarousel section={{ title, items: songs }} />
      ) : (
        <Text style={[s.sub, { paddingHorizontal: 16, marginBottom: 20 }]}>{pick === 'time' ? 'この時間帯に聴いた曲は、まだありません。' : 'このタグの曲は、まだありません。'}</Text>
      )}
    </View>
  );
}
