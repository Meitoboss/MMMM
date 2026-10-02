import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProgress } from 'react-native-track-player';

import { activeLineIndex, findLyrics, parseLrc } from '../src/core';
import { LOCAL_ARTIST, isLocalId } from '../src/core/localMeta';
import type { Lyrics } from '../src/core/types';
import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import { usePlayer } from '../src/state/player';
import { useSettings } from '../src/state/settings';
import { Cover, SongRow } from '../src/ui/components';
import { useAddToPlaylist } from '../src/ui/actions';
import { showActionSheet } from '../src/ui/dialogs';
import { colors, useScheme } from '../src/ui/theme';

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEP = [5, 15, 30, 45, 60];

type View_ = 'cover' | 'lyrics' | 'queue';

export default function PlayerScreen() {
  useScheme();
  const showDebug = useSettings((st) => st.showDebug);
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
    if (!song || (isLocalId(song.id) && song.artists[0]?.name === LOCAL_ARTIST)) return; // nothing to search with
    if (view !== 'lyrics' && !autoLyrics) return;
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
        <Text style={{ color: colors.sub }}>再生中の曲はありません</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.accentText, marginTop: 12 }}>閉じる</Text></Pressable>
      </View>
    );
  }

  const shown = seeking ?? position;
  const cover = Math.min(width - 48, 360);

  const menu = () => {
    const opts = ['プレイリストに追加', `再生速度（${p.rate}×）`, p.sleepAt ? 'スリープタイマーを解除' : 'スリープタイマー', 'この曲のラジオを開始', 'キャンセル'];
    showActionSheet({ options: opts, cancelButtonIndex: opts.length - 1 }, (i) => {
      if (i === 0) { useAddToPlaylist.setState({ song }); router.push('/add-to-playlist'); }
      if (i === 1) {
        const r = [...RATES.map((x) => `${x}×`), 'キャンセル'];
        showActionSheet({ options: r, cancelButtonIndex: r.length - 1 }, (j) => { if (j < RATES.length) void p.setRate(RATES[j]); });
      }
      if (i === 2) {
        if (p.sleepAt) return p.setSleepTimer(null);
        const r = [...SLEEP.map((x) => `${x}分`), 'キャンセル'];
        showActionSheet({ options: r, cancelButtonIndex: r.length - 1 }, (j) => { if (j < SLEEP.length) p.setSleepTimer(SLEEP[j]); });
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
              <Text style={{ color: view === v ? colors.accentText : colors.sub, fontWeight: view === v ? '800' : '600' }}>{{ cover: 'ジャケット', lyrics: '歌詞', queue: 'キュー' }[v]}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable hitSlop={12} onPress={menu}><Ionicons name="ellipsis-horizontal" size={24} color={colors.text} /></Pressable>
      </View>

      <View style={{ flex: 1, marginTop: 16 }}>
        {view === 'cover' && (
          <View style={{ alignItems: 'center' }}>
            <Cover uri={song.thumbnail} size={cover} />
            {(showDebug || p.status === 'error') && (
              <Text selectable style={{ color: colors.sub, fontSize: 10, marginTop: 8, paddingHorizontal: 20, alignSelf: 'stretch' }}>
                {p.debug.join('\n')}
              </Text>
            )}
            {p.status === 'error' && (
              <ScrollView style={{ maxHeight: 140, marginTop: 12, paddingHorizontal: 16 }}>
                <Text selectable style={{ color: colors.danger, textAlign: 'center', fontSize: 12 }}>{p.error}</Text>
                <Text style={{ color: colors.sub, textAlign: 'center', fontSize: 12, marginTop: 6 }}>設定の「トークンサーバー」を確認すると直る場合があります。</Text>
              </ScrollView>
            )}
          </View>
        )}
        {view === 'lyrics' && (
          lyrics === 'loading' ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>歌詞を検索中…</Text>
          : !lines.length ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>歌詞が見つかりませんでした</Text>
          : <FlatList ref={listRef} data={lines} keyExtractor={(_, i) => String(i)} onScrollToIndexFailed={() => undefined}
              contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 40 }}
              renderItem={({ item, index }) => (
                <Pressable disabled={!(lyrics as Lyrics).synced} onPress={() => void p.seekTo(item.time / 1000)}>
                  <Text style={{ fontSize: 22, fontWeight: '700', marginVertical: 8, color: index === active || active === -1 ? colors.text : colors.dim }}>{item.text || '♪'}</Text>
                </Pressable>
              )} />
        )}
        {view === 'queue' && (
          <FlatList data={p.queue} keyExtractor={(x, i) => `${x.id}-${i}`}
            initialScrollIndex={Math.max(0, Math.min(p.index, p.queue.length - 1))} getItemLayout={(_, i) => ({ length: 64, offset: 64 * i, index: i })}
            renderItem={({ item, index }) => (
              <View style={{ backgroundColor: index === p.index ? colors.surface : undefined }}>
                <SongRow song={item} onPress={() => void p.jumpTo(index)}
                  right={index !== p.index ? <Pressable hitSlop={10} onPress={() => p.removeFromQueue(index)}><Ionicons name="close" size={18} color={colors.sub} /></Pressable> : <Ionicons name="volume-medium" size={18} color={colors.accentText} />} />
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
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? colors.accentText : colors.text} />
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
          <Pressable onPress={p.toggleShuffle}><Ionicons name="shuffle" size={26} color={p.shuffle ? colors.accentText : colors.sub} /></Pressable>
          <Pressable onPress={() => void p.previous()}><Ionicons name="play-skip-back" size={34} color={colors.text} /></Pressable>
          <Pressable onPress={() => void p.togglePlay()} style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={p.status === 'loading' ? 'hourglass' : p.status === 'playing' ? 'pause' : 'play'} size={34} color={colors.onAccent} />
          </Pressable>
          <Pressable onPress={() => void p.next()}><Ionicons name="play-skip-forward" size={34} color={colors.text} /></Pressable>
          <Pressable onPress={() => p.setRepeat(p.repeat === 'off' ? 'all' : p.repeat === 'all' ? 'one' : 'off')}>
            <Ionicons name={p.repeat === 'one' ? 'repeat' : 'repeat'} size={26} color={p.repeat === 'off' ? colors.sub : colors.accentText} />
            {p.repeat === 'one' && <Text style={{ position: 'absolute', right: -2, top: -4, color: colors.accentText, fontSize: 11, fontWeight: '800' }}>1</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
