import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProgress } from 'react-native-track-player';

import { activeLineIndex, findLyrics, parseLrc } from '../src/core';
import type { Lyrics } from '../src/core/types';
import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import { usePlayer } from '../src/state/player';
import { useSettings } from '../src/state/settings';
import { Cover, SongRow } from '../src/ui/components';
import { useAddToPlaylist } from '../src/ui/actions';
import { colors } from '../src/ui/theme';

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEP = [5, 15, 30, 45, 60];

type View_ = 'cover' | 'lyrics' | 'queue';

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const p = usePlayer();
  const { position, duration } = useProgress(500);
  const [view, setView] = useState<View_>('cover');
  const [liked, setLiked] = useState(false);
  const [seeking, setSeeking] = useState<number | null>(null);
  const [lyrics, setLyrics] = useState<Lyrics | null | 'loading'>(null);
  const autoLyrics = useSettings((s) => s.autoLyrics);
  const listRef = useRef<FlatList>(null);
  const song = p.current;

  useEffect(() => {
    if (!song) return;
    void openDb().then((db) => repo.isLiked(db, song.id)).then(setLiked);
  }, [song?.id]);

  // lyrics: cache → LRCLIB → KuGou
  useEffect(() => {
    setLyrics(null);
    if (!song || view !== 'lyrics' && !autoLyrics) return;
    const ctl = new AbortController();
    setLyrics('loading');
    (async () => {
      const db = await openDb();
      const cached = await repo.getCachedLyrics(db, song.id);
      if (cached?.synced) return setLyrics({ source: 'lrclib', synced: true, lines: parseLrc(cached.synced) });
      if (cached?.fixed) return setLyrics({ source: 'lrclib', synced: false, lines: cached.fixed.split('\n').map((text) => ({ time: 0, text })), plain: cached.fixed });
      const l = await findLyrics({ artist: song.artists[0]?.name ?? '', title: song.title, durationSec: song.durationSec ?? (duration || undefined), album: song.album?.name }, ctl.signal);
      if (ctl.signal.aborted) return;
      setLyrics(l);
      if (l) void repo.cacheLyrics(db, song, l);
    })().catch(() => !ctl.signal.aborted && setLyrics(null));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id, autoLyrics, view === 'lyrics']);

  const lines = lyrics && lyrics !== 'loading' ? lyrics.lines : [];
  const active = lyrics && lyrics !== 'loading' && lyrics.synced ? activeLineIndex(lines, position * 1000) : -1;
  useEffect(() => {
    if (view === 'lyrics' && active > 0) listRef.current?.scrollToIndex({ index: active, viewPosition: 0.4, animated: true });
  }, [active, view]);

  if (!song) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Text style={{ color: colors.sub }}>Nothing playing</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.accent, marginTop: 12 }}>Close</Text></Pressable>
      </View>
    );
  }

  const shown = seeking ?? position;
  const cover = Math.min(width - 48, 360);

  const menu = () => {
    const opts = ['Add to playlist', `Speed (${p.rate}×)`, p.sleepAt ? 'Cancel sleep timer' : 'Sleep timer', 'Start radio', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options: opts, cancelButtonIndex: opts.length - 1 }, (i) => {
      if (i === 0) { useAddToPlaylist.setState({ song }); router.push('/add-to-playlist'); }
      if (i === 1) {
        const r = [...RATES.map((x) => `${x}×`), 'Cancel'];
        ActionSheetIOS.showActionSheetWithOptions({ options: r, cancelButtonIndex: r.length - 1 }, (j) => { if (j < RATES.length) void p.setRate(RATES[j]); });
      }
      if (i === 2) {
        if (p.sleepAt) return p.setSleepTimer(null);
        const r = [...SLEEP.map((x) => `${x} min`), 'Cancel'];
        ActionSheetIOS.showActionSheetWithOptions({ options: r, cancelButtonIndex: r.length - 1 }, (j) => { if (j < SLEEP.length) p.setSleepTimer(SLEEP[j]); });
      }
      if (i === 3) void p.playRadio(song);
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 }}>
        <Pressable hitSlop={12} onPress={() => router.back()}><Ionicons name="chevron-down" size={28} color={colors.text} /></Pressable>
        <View style={{ flexDirection: 'row', gap: 20 }}>
          {(['cover', 'lyrics', 'queue'] as const).map((v) => (
            <Pressable key={v} onPress={() => setView(v)}>
              <Text style={{ color: view === v ? colors.accent : colors.sub, fontWeight: '600', textTransform: 'capitalize' }}>{v}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable hitSlop={12} onPress={menu}><Ionicons name="ellipsis-horizontal" size={24} color={colors.text} /></Pressable>
      </View>

      <View style={{ flex: 1, marginTop: 16 }}>
        {view === 'cover' && (
          <View style={{ alignItems: 'center' }}>
            <Cover uri={song.thumbnail} size={cover} />
            {p.status === 'error' && <Text style={{ color: colors.danger, margin: 16, textAlign: 'center' }} numberOfLines={4}>{p.error}</Text>}
          </View>
        )}
        {view === 'lyrics' && (
          lyrics === 'loading' ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>Searching lyrics…</Text>
          : !lines.length ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>No lyrics found</Text>
          : <FlatList ref={listRef} data={lines} keyExtractor={(_, i) => String(i)} onScrollToIndexFailed={() => undefined}
              contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 40 }}
              renderItem={({ item, index }) => (
                <Pressable disabled={!(lyrics as Lyrics).synced} onPress={() => void p.seekTo(item.time / 1000)}>
                  <Text style={{ fontSize: 22, fontWeight: '700', marginVertical: 8, color: index === active || active === -1 ? colors.text : '#555' }}>{item.text || '♪'}</Text>
                </Pressable>
              )} />
        )}
        {view === 'queue' && (
          <FlatList data={p.queue} keyExtractor={(x, i) => `${x.id}-${i}`}
            initialScrollIndex={Math.max(0, Math.min(p.index, p.queue.length - 1))} getItemLayout={(_, i) => ({ length: 64, offset: 64 * i, index: i })}
            renderItem={({ item, index }) => (
              <View style={{ backgroundColor: index === p.index ? colors.surface : undefined }}>
                <SongRow song={item} onPress={() => void p.jumpTo(index)}
                  right={index !== p.index ? <Pressable hitSlop={10} onPress={() => p.removeFromQueue(index)}><Ionicons name="close" size={18} color={colors.sub} /></Pressable> : <Ionicons name="volume-medium" size={18} color={colors.accent} />} />
              </View>
            )} />
        )}
      </View>

      <View style={{ paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }} numberOfLines={1}>{song.title}</Text>
            <Text style={{ color: colors.sub, fontSize: 15 }} numberOfLines={1}>{song.artists.map((a) => a.name).join(', ')}</Text>
          </View>
          <Pressable hitSlop={12} onPress={async () => setLiked(await repo.toggleLike(await openDb(), song))}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? colors.accent : colors.text} />
          </Pressable>
        </View>

        <Slider
          style={{ marginTop: 12 }}
          minimumValue={0}
          maximumValue={Math.max(1, duration || song.durationSec || 1)}
          value={shown}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.surface2}
          thumbTintColor={colors.accent}
          onValueChange={setSeeking}
          onSlidingComplete={async (v) => { await p.seekTo(v); setSeeking(null); }}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.sub, fontSize: 12 }}>{fmt(shown)}</Text>
          <Text style={{ color: colors.sub, fontSize: 12 }}>{fmt(duration || song.durationSec || 0)}</Text>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <Pressable onPress={p.toggleShuffle}><Ionicons name="shuffle" size={26} color={p.shuffle ? colors.accent : colors.sub} /></Pressable>
          <Pressable onPress={() => void p.previous()}><Ionicons name="play-skip-back" size={34} color={colors.text} /></Pressable>
          <Pressable onPress={() => void p.togglePlay()} style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={p.status === 'loading' ? 'hourglass' : p.status === 'playing' ? 'pause' : 'play'} size={34} color="#000" />
          </Pressable>
          <Pressable onPress={() => void p.next()}><Ionicons name="play-skip-forward" size={34} color={colors.text} /></Pressable>
          <Pressable onPress={() => p.setRepeat(p.repeat === 'off' ? 'all' : p.repeat === 'all' ? 'one' : 'off')}>
            <Ionicons name={p.repeat === 'one' ? 'repeat' : 'repeat'} size={26} color={p.repeat === 'off' ? colors.sub : colors.accent} />
            {p.repeat === 'one' && <Text style={{ position: 'absolute', right: -2, top: -4, color: colors.accent, fontSize: 11, fontWeight: '800' }}>1</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
