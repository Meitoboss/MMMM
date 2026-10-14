import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProgress } from 'react-native-track-player';

import { activeLineIndex, findLyrics, parseLrc } from '../src/core';
import { onThisPhone } from '../src/core/dj';
import { LOCAL_ARTIST, isLocalId } from '../src/core/localMeta';
import { lineRegion } from '../src/core/loop';
import { type Drag, HOLD_MS, type SeekBand, dragMoved, holdReached, isEcho, shownPosition, sliderValue } from '../src/core/seekDrag';
import { seekLength } from '../src/core/songLength';
import { swipeGate } from '../src/core/swipe';
import { hiResCover } from '../src/core/taste';
import { encodeSong } from '../src/core/songParam';
import { toggleLikeSong, useIsLiked } from '../src/state/likes';
import type { Lyrics } from '../src/core/types';
import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import { usePlayer } from '../src/state/player';
import { useSettings } from '../src/state/settings';
import { Cover, SongRow } from '../src/ui/components';
import { useAddToPlaylist } from '../src/ui/actions';
import { Aurora } from '../src/ui/Aurora';
import { DjPanel } from '../src/ui/DjPanel';
import { InlineSheetLayer, showActionSheet } from '../src/ui/dialogs';
import { SeekBar } from '../src/ui/SeekBar';
import { useSwipeDown } from '../src/ui/useSwipeDown';
import { requestOfflineSave } from '../src/ui/offlineActions';
import { useOffline } from '../src/state/offline';
import { colors, useScheme } from '../src/ui/theme';

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEP = [5, 15, 30, 45, 60];

type View_ = 'cover' | 'lyrics' | 'queue' | 'dj';

export default function PlayerScreen() {
  useScheme();
  const showDebug = useSettings((st) => st.showDebug);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const p = usePlayer();
  // Swipe down from anywhere to close. A list that has been scrolled down scrolls back first – except for a touch that begins in the top bar.
  const listTop = useRef(0);
  const onList = (e: { nativeEvent: { contentOffset: { y: number } } }) => { listTop.current = e.nativeEvent.contentOffset.y; };
  // Where the seek bar is on the screen. A touch that BEGINS there is the slider's, never a swipe (on Android the slider and the swipe
  // would fight over it). Decided from the position, not from "touch started / ended" messages: on iPhone the slider can swallow the
  // end of a touch, and a flag that waited for it would stay set and the screen could never be swiped closed again.
  const seekRef = useRef<View>(null);
  const seekBand = useRef<SeekBand | null>(null);
  const measureSeek = () => {
    // `measure` gives pageY: the same coordinates as the pageY of a touch (measureInWindow would be off by the gap above a sheet)
    seekRef.current?.measure?.((_x, _y, _w, h, _pageX, pageY) => {
      if (Number.isFinite(pageY) && h > 0) seekBand.current = { top: pageY, bottom: pageY + h };
    });
  };
  // The seek bar is left out of the swipe on Android only (that is where the two fight; on iPhone the slider does not, and a wrong
  // measurement must never be able to refuse a swipe there). With "デバッグ表示" on, what happens to every touch is written to the log.
  // iPhone: the player is a sheet, and the sheet's OWN swipe closes it (it was taken away from our swipe after a few points: the screen moved
  // a little and sprang back). Android: the screen is closed by the swipe of this app.
  const closesBySwipe = Platform.OS !== 'ios';
  const swipe = useSwipeDown(
    () => router.back(),
    (touchY) => swipeGate({ touchY, seekBand: Platform.OS === 'android' ? seekBand.current : null, listTop: listTop.current, topLimit: insets.top + 64 }),
    showDebug ? (line) => p.log(line) : undefined,
  );
  const showLog = showDebug || p.status === 'error'; // the playback log takes the aurora's place
  const { position, duration } = useProgress(500);
  const [view, setView] = useState<View_>('cover');
  useEffect(() => { listTop.current = 0; }, [view]); // a tab starts at its top
  // while this screen is open the mini bar stays hidden (it would sit on the controls)
  useEffect(() => {
    usePlayer.getState().setPlayerScreenOpen(true);
    return () => usePlayer.getState().setPlayerScreenOpen(false);
  }, []);
  const [drag, setDrag] = useState<Drag | null>(null); // while a finger is on the seek bar
  const [hold, setHold] = useState<number | null>(null); // the chosen position, until the player has caught up
  const [lyrics, setLyrics] = useState<Lyrics | null | 'loading'>(null);
  const autoLyrics = useSettings((s) => s.autoLyrics);
  const listRef = useRef<FlatList>(null);
  const song = p.current;
  const liked = useIsLiked(song?.id);
  // the DJ tab is for songs saved on this phone only
  const savedIds = useOffline((st) => st.ids);
  const djAllowed = !!song && onThisPhone(song.id, savedIds);
  const tabs: View_[] = djAllowed ? ['cover', 'lyrics', 'queue', 'dj'] : ['cover', 'lyrics', 'queue'];
  useEffect(() => {
    if (!djAllowed && view === 'dj') setView('cover');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [djAllowed]);

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
  const livePosition = p.needsLoad ? (p.resumePosition ?? 0) : position; // a restored song has not been loaded yet
  // the bar can move (another tab, another song, a different top): measure it again then
  useEffect(() => {
    const id = requestAnimationFrame(measureSeek);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, song?.id, insets.top]);
  // the hold ends when the player reports a position close to the chosen one (or after a moment)
  useEffect(() => { if (holdReached(hold, livePosition)) setHold(null); }, [hold, livePosition]);
  useEffect(() => {
    if (hold === null) return;
    const t = setTimeout(() => setHold(null), HOLD_MS);
    return () => clearTimeout(t);
  }, [hold]);
  const active = lyrics && lyrics !== 'loading' && lyrics.synced ? activeLineIndex(lines, livePosition * 1000) : -1;
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

  const shown = shownPosition(drag, hold, livePosition);
  // the length the seek bar runs over: the player's, unless it says about double (then the song's own), and never the one second that
  // a slider falls back to when neither is known yet
  const total = seekLength(duration, song.durationSec);
  const given = sliderValue(drag, hold, livePosition); // the value the slider is handed: what it reports back is an echo, not a finger
  // what the seek bar does with a finger (the same on both platforms): a drag shows the finger's position, lifting seeks there
  const seekStart = (v: number) => setDrag((d) => dragMoved(d, v));
  const seekFinger = (v: number) => setDrag((d) => dragMoved(d, v));
  const seekDone = async (v: number) => {
    setHold(v);
    setDrag(null);
    p.log(`seek: to ${v.toFixed(1)}s (the bar runs to ${total.toFixed(0)}s)`);
    try {
      await p.seekTo(v);
      p.log(`seek: the player is at ${(await p.getPosition()).toFixed(1)}s`);
    } catch (e) {
      p.log(`seek: failed – ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // iPhone: the screen is a sheet that already starts below the status bar. Android: it reaches under it, and the header would be covered
  const topPad = (Platform.OS === 'android' ? insets.top + 8 : 0) + 12;
  const sidePad = Math.max(20, insets.left + 12, insets.right + 12);
  const cover = Math.min(width - 90, 300); // the aurora glows around and behind it

  const menu = () => {
    const local = isLocalId(song.id);
    const onPhone = djAllowed;
    const saved = !!useOffline.getState().ids[song.id];
    const opts = [
      'プレイリストに追加',
      'タグを編集',
      ...(onPhone ? ['DJ（テンポ・ループ・キュー）を開く'] : []),
      `再生速度（${p.rate}×）`,
      p.sleepAt ? 'スリープタイマーを解除' : 'スリープタイマー',
      'この曲のラジオを開始',
      ...(local ? [] : [saved ? 'オフライン保存を削除' : 'オフラインに保存']),
      'キャンセル',
    ];
    showActionSheet({ options: opts, cancelButtonIndex: opts.length - 1 }, (i) => {
      const label = opts[i];
      if (label === 'プレイリストに追加') {
        useAddToPlaylist.setState({ song });
        router.push('/add-to-playlist');
      } else if (label === 'タグを編集') {
        router.push({ pathname: '/song-tags', params: { song: encodeSong(song) } });
      } else if (label === 'DJ（テンポ・ループ・キュー）を開く') {
        setView('dj');
      } else if (label.startsWith('再生速度')) {
        const r = [...RATES.map((x) => `${x}×`), 'キャンセル'];
        showActionSheet({ options: r, cancelButtonIndex: r.length - 1 }, (j) => { if (j < RATES.length) void p.setRate(RATES[j]); });
      } else if (label === 'スリープタイマー') {
        const r = [...SLEEP.map((x) => `${x}分`), 'キャンセル'];
        showActionSheet({ options: r, cancelButtonIndex: r.length - 1 }, (j) => { if (j < SLEEP.length) p.setSleepTimer(SLEEP[j]); });
      } else if (label === 'スリープタイマーを解除') {
        p.setSleepTimer(null);
      } else if (label === 'この曲のラジオを開始') {
        void p.playRadio(song);
      } else if (label === 'オフライン保存を削除') {
        void useOffline.getState().remove(song.id);
      } else if (label === 'オフラインに保存') {
        void requestOfflineSave([song]);
      }
    });
  };

  return (
    <Animated.View testID="player-root" {...(closesBySwipe ? swipe.panHandlers : {})} style={{ flex: 1, backgroundColor: colors.bg, paddingTop: topPad, paddingBottom: insets.bottom + 12, transform: [{ translateY: swipe.translateY }] }}>
      <View testID="player-header" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: sidePad }}>
        <Pressable hitSlop={16} onPress={() => router.back()}><Ionicons name="chevron-down" size={28} color={colors.text} /></Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {tabs.map((v) => (
            <Pressable key={v} hitSlop={{ top: 12, bottom: 12 }} style={{ paddingHorizontal: 8, paddingVertical: 6 }} onPress={() => setView(v)}>
              <Text style={{ color: view === v ? colors.accentText : colors.sub, fontWeight: view === v ? '800' : '600' }}>{{ cover: 'ジャケット', lyrics: '歌詞', queue: 'キュー', dj: 'DJ' }[v]}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable hitSlop={16} onPress={menu}><Ionicons name="ellipsis-horizontal" size={24} color={colors.text} /></Pressable>
      </View>

      <View style={{ flex: 1, marginTop: 16 }}>
        {view === 'cover' && (
          <View testID="player-cover" style={{ flex: 1 }}>
            {/* the aurora is the background of this whole area, BEHIND the cover – no frame; its edges dissolve into the screen */}
            {!showLog && <Aurora testID="aurora" playing={p.status === 'playing'} rate={p.tempo ?? p.rate} style={StyleSheet.absoluteFill} />}
            <View style={showLog ? { alignItems: 'center' } : { flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ borderRadius: 14, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 14 }}>
                <Cover uri={hiResCover(song.thumbnail, 900)} size={cover} />
              </View>
            </View>
            {showLog && (
              <ScrollView testID="player-log" onScroll={onList} scrollEventThrottle={16} bounces={false} overScrollMode="never" style={{ flex: 1, marginTop: 8 }} contentContainerStyle={{ paddingHorizontal: 20 }}>
                <Text selectable style={{ color: colors.sub, fontSize: 10 }}>
                  {p.debug.join('\n')}
                </Text>
                {p.status === 'error' && (
                  <View style={{ marginTop: 12 }}>
                    <Text selectable style={{ color: colors.danger, textAlign: 'center', fontSize: 12 }}>{p.error}</Text>
                    <Text style={{ color: colors.sub, textAlign: 'center', fontSize: 12, marginTop: 6 }}>設定の「トークンサーバー」を確認すると直る場合があります。</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        )}
        {view === 'lyrics' && (
          lyrics === 'loading' ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>歌詞を検索中…</Text>
          : !lines.length ? <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 40 }}>歌詞が見つかりませんでした</Text>
          : <FlatList testID="player-lyrics" ref={listRef} onScroll={onList} scrollEventThrottle={16} bounces={false} overScrollMode="never" data={lines} keyExtractor={(_, i) => String(i)} onScrollToIndexFailed={() => undefined}
              contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 40 }}
              renderItem={({ item, index }) => (
                <Pressable disabled={!(lyrics as Lyrics).synced} onPress={() => void p.seekTo(item.time / 1000)} onLongPress={() => { const r = lineRegion(lines.map((l) => l.time), index, song.durationSec ?? (duration || undefined)); if (r) void p.loopRegion(r); }}>
                  <Text style={{ fontSize: 22, fontWeight: '700', marginVertical: 8, color: index === active || active === -1 ? colors.text : colors.dim }}>{item.text || '♪'}</Text>
                </Pressable>
              )} />
        )}
        {view === 'dj' && djAllowed && (
          <ScrollView testID="player-dj" onScroll={onList} scrollEventThrottle={16} bounces={false} overScrollMode="never" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
            <DjPanel song={song} />
          </ScrollView>
        )}
        {view === 'queue' && (
          <FlatList testID="player-queue" onScroll={onList} scrollEventThrottle={16} bounces={false} overScrollMode="never" data={p.queue} keyExtractor={(x, i) => `${x.id}-${i}`}
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
        <View testID="player-title" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }} numberOfLines={1}>{song.title}</Text>
            <Text style={{ color: colors.sub, fontSize: 15 }} numberOfLines={1}>{song.artists.map((a) => a.name).join(', ')}</Text>
          </View>
          {/* make a playlist / put the song in one: the same screen as the menu's "プレイリストに追加" (it can create one too) */}
          <Pressable testID="player-add-playlist" hitSlop={12} onPress={() => { useAddToPlaylist.setState({ song }); router.push('/add-to-playlist'); }} style={{ marginRight: 16 }}>
            <Ionicons name="add-circle-outline" size={28} color={colors.text} />
          </Pressable>
          <Pressable testID="player-like" hitSlop={12} onPress={() => void toggleLikeSong(song)}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? colors.accentText : colors.text} />
          </Pressable>
        </View>

        <View ref={seekRef} testID="player-seek" collapsable={false} onLayout={measureSeek} style={{ marginTop: 12 }}>
          {Platform.OS === 'android' ? (
            // Android: the app's own bar (the native slider did not react to touches at all); it follows the finger itself
            <SeekBar
              testID="player-seekbar"
              value={shown}
              max={total}
              onStart={seekStart}
              onChange={seekFinger}
              onComplete={seekDone}
              onCancel={() => setDrag(null)}
              report={showDebug ? (line) => p.log(line) : undefined}
              trackColor={colors.surface2}
              fillColor={colors.accent}
              thumbColor={colors.accent}
            />
          ) : (
            <Slider
              style={{ height: 40 }}
              minimumValue={0}
              maximumValue={total}
              value={given}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.surface2}
              thumbTintColor={colors.accent}
              onSlidingStart={seekStart}
              onValueChange={(v) => setDrag((d) => (d || !isEcho(v, given) ? dragMoved(d, v) : d))}
              onSlidingComplete={seekDone}
            />
          )}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.sub, fontSize: 12 }}>{fmt(shown)}</Text>
          <Text style={{ color: colors.sub, fontSize: 12 }}>{fmt(duration > 1 || song.durationSec ? total : 0)}</Text>
        </View>

        {(p.loop || p.loopA !== undefined) && (
          <Pressable onPress={() => djAllowed && setView('dj')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Ionicons name="repeat" size={16} color={colors.accentText} />
            <Text style={{ flex: 1, color: colors.accentText, fontSize: 12 }} numberOfLines={1}>
              {p.loop ? `ループ中 ${fmt(p.loop.start)} – ${fmt(p.loop.end)}` : `A ${fmt(p.loopA ?? 0)} → 終わりの位置で B を押してください`}
            </Text>
            <Pressable hitSlop={10} onPress={p.clearLoop}><Ionicons name="close-circle" size={20} color={colors.sub} /></Pressable>
          </Pressable>
        )}

        <View testID="player-controls" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
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
      <InlineSheetLayer />
    </Animated.View>
  );
}
