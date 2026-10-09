import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProgress } from 'react-native-track-player';

import { activeLineIndex, findLyrics, parseLrc } from '../src/core';
import { HOT_CUE_SLOTS, type HotCue } from '../src/core/dj';
import { LOCAL_ARTIST, isLocalId } from '../src/core/localMeta';
import { lineRegion } from '../src/core/loop';
import { encodeSong } from '../src/core/songParam';
import { toggleLikeSong, useIsLiked } from '../src/state/likes';
import { showDjBetaOnce } from '../src/ui/betaNotice';
import type { Lyrics } from '../src/core/types';
import { openDb } from '../src/db/expo';
import * as repo from '../src/db/repo';
import { usePlayer } from '../src/state/player';
import { useSettings } from '../src/state/settings';
import { Cover, SongRow } from '../src/ui/components';
import { useAddToPlaylist } from '../src/ui/actions';
import { Aurora } from '../src/ui/Aurora';
import { BpmPanel } from '../src/ui/BpmPanel';
import { promptText, showActionSheet } from '../src/ui/dialogs';
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
  const swipe = useSwipeDown(() => router.back(), (touchY) => listTop.current <= 2 || touchY < insets.top + 64);
  const showLog = showDebug || p.status === 'error'; // the playback log takes the aurora's place
  const { position, duration } = useProgress(500);
  const [view, setView] = useState<View_>('cover');
  useEffect(() => { listTop.current = 0; }, [view]); // a tab starts at its top
  const [seeking, setSeeking] = useState<number | null>(null);
  const [lyrics, setLyrics] = useState<Lyrics | null | 'loading'>(null);
  const autoLyrics = useSettings((s) => s.autoLyrics);
  const fadeSeconds = useSettings((s) => s.fadeSeconds);
  const listRef = useRef<FlatList>(null);
  const song = p.current;
  const [cues, setCues] = useState<HotCue[]>([]);
  const liked = useIsLiked(song?.id);

  // hot cues of the song that is playing
  useEffect(() => {
    setCues([]);
    if (!song) return;
    let on = true;
    void openDb().then((db) => repo.hotCues(db, song.id)).then((c) => on && setCues(c));
    return () => {
      on = false;
    };
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
  const livePosition = p.needsLoad ? (p.resumePosition ?? 0) : position; // a restored song has not been loaded yet
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

  const shown = seeking ?? livePosition;
  const cover = Math.min(width - 90, 300); // the aurora glows around and behind it

  const reloadCues = async () => {
    if (song) setCues(await repo.hotCues(await openDb(), song.id));
  };
  const cueFail = (e: unknown) => Alert.alert('キューを保存できません', e instanceof Error ? e.message : String(e));
  const setCue = async (slot: number) => {
    try {
      await repo.setHotCue(await openDb(), song, slot, await p.getPosition());
      await reloadCues();
    } catch (e) {
      cueFail(e);
    }
  };
  /** jump to a cue and play from there (a paused or restored song starts) */
  const jumpCue = async (c: HotCue) => {
    await p.seekTo(c.position);
    if (usePlayer.getState().status === 'paused') await usePlayer.getState().togglePlay();
  };
  const cueMenu = (slot: number, cue: HotCue) =>
    showActionSheet(
      { title: `キュー ${slot + 1}`, message: `${fmt(cue.position)}${cue.label ? `・${cue.label}` : ''}`, options: ['ここ（いまの位置）に更新', '名前を付ける', '削除', 'キャンセル'], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
      (i) => {
        if (i === 0) void setCue(slot);
        else if (i === 1) {
          promptText('キューの名前', undefined, cue.label ?? '', async (v) => {
            try {
              await repo.setHotCue(await openDb(), song, slot, cue.position, v);
              await reloadCues();
            } catch (e) {
              cueFail(e);
            }
          });
        } else if (i === 2) {
          void openDb().then((db) => repo.deleteHotCue(db, song.id, slot)).then(reloadCues);
        }
      },
    );

  const trimSorry = () => Alert.alert('設定できません', 'スタートは曲の始めの0.5秒より後、エンドは曲の終わりより前にして、2つの間は1秒以上あけてください。');
  const trimStart = async () => {
    const kept = await p.markTrimStart(await p.getPosition());
    if (kept?.startSec === undefined) trimSorry();
  };
  const trimEnd = async () => {
    const kept = await p.markTrimEnd(await p.getPosition());
    if (kept?.endSec === undefined) trimSorry();
  };

  const menu = () => {
    const local = isLocalId(song.id);
    const saved = !!useOffline.getState().ids[song.id];
    const opts = [
      'プレイリストに追加',
      'タグを編集',
      'スタート／エンド位置…',
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
      } else if (label === 'スタート／エンド位置…') {
        const t = p.trim;
        const state = t ? `${t.startSec !== undefined ? `スタート ${fmt(t.startSec)}` : ''}${t.startSec !== undefined && t.endSec !== undefined ? ' / ' : ''}${t.endSec !== undefined ? `エンド ${fmt(t.endSec)}` : ''}` : 'まだ設定していません';
        const o = ['スタートを、いまの位置にする', 'エンドを、いまの位置にする', 'スタート／エンドを解除', 'キャンセル'];
        showActionSheet({ title: 'スタート／エンド位置', message: state, options: o, destructiveButtonIndex: 2, cancelButtonIndex: 3 }, async (j) => {
          if (j === 0) await trimStart();
          else if (j === 1) await trimEnd();
          else if (j === 2) await p.clearTrim();
        });
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
    <Animated.View testID="player-root" {...swipe.panHandlers} style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 12, paddingBottom: insets.bottom + 12, transform: [{ translateY: swipe.translateY }] }}>
      <View testID="player-header" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 }}>
        <Pressable hitSlop={12} onPress={() => router.back()}><Ionicons name="chevron-down" size={28} color={colors.text} /></Pressable>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          {(['cover', 'lyrics', 'queue', 'dj'] as const).map((v) => (
            <Pressable key={v} onPress={() => { setView(v); if (v === 'dj') showDjBetaOnce(); }}>
              <Text style={{ color: view === v ? colors.accentText : colors.sub, fontWeight: view === v ? '800' : '600' }}>{{ cover: 'ジャケット', lyrics: '歌詞', queue: 'キュー', dj: 'DJ' }[v]}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable hitSlop={12} onPress={menu}><Ionicons name="ellipsis-horizontal" size={24} color={colors.text} /></Pressable>
      </View>

      <View style={{ flex: 1, marginTop: 16 }}>
        {view === 'cover' && (
          <View testID="player-cover" style={{ flex: 1 }}>
            {/* the aurora is the background of this whole area, BEHIND the cover – no frame; its edges dissolve into the screen */}
            {!showLog && <Aurora testID="aurora" playing={p.status === 'playing'} rate={p.tempo ?? p.rate} style={StyleSheet.absoluteFill} />}
            <View style={showLog ? { alignItems: 'center' } : { flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ borderRadius: 14, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 14 }}>
                <Cover uri={song.thumbnail} size={cover} />
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
        {view === 'dj' && (
          <ScrollView testID="player-dj" onScroll={onList} scrollEventThrottle={16} bounces={false} overScrollMode="never" contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>DJ</Text>
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.accent }}>
                <Text style={{ color: colors.onAccent, fontSize: 11, fontWeight: '800' }}>ベータ版</Text>
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>区間ループ</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable testID="loop-a" onPress={async () => p.markLoopA(await p.getPosition())} style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 16, backgroundColor: p.loopA !== undefined || p.loop ? colors.accent : colors.surface2 }}>
                  <Text style={{ color: p.loopA !== undefined || p.loop ? colors.onAccent : colors.text, fontWeight: '800' }}>A</Text>
                </Pressable>
                <Pressable testID="loop-b" disabled={p.loopA === undefined} onPress={async () => p.markLoopB(await p.getPosition())} style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 16, opacity: p.loopA === undefined ? 0.4 : 1, backgroundColor: p.loop ? colors.accent : colors.surface2 }}>
                  <Text style={{ color: p.loop ? colors.onAccent : colors.text, fontWeight: '800' }}>B</Text>
                </Pressable>
                <Text style={{ flex: 1, color: p.loop || p.loopA !== undefined ? colors.accentText : colors.sub, fontSize: 12 }} numberOfLines={2}>
                  {p.loop ? `ループ中 ${fmt(p.loop.start)} – ${fmt(p.loop.end)}` : p.loopA !== undefined ? `A ${fmt(p.loopA)} → 終わりの位置で B を押す` : '始めの位置で A、終わりの位置で B を押します'}
                </Text>
                {(p.loop || p.loopA !== undefined) && (
                  <Pressable hitSlop={10} onPress={p.clearLoop}><Ionicons name="close-circle" size={24} color={colors.sub} /></Pressable>
                )}
              </View>
              <Text style={{ color: colors.sub, fontSize: 11 }}>歌詞の画面では、行を長押しすると、その行をループします。</Text>
            </View>

            <BpmPanel song={song} />

            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>ホットキュー</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {Array.from({ length: HOT_CUE_SLOTS }, (_, slot) => {
                  const cue = cues.find((c) => c.slot === slot);
                  return (
                    <Pressable
                      key={slot}
                      testID={`cue-${slot}`}
                      onPress={() => (cue ? void jumpCue(cue) : void setCue(slot))}
                      onLongPress={() => cue && cueMenu(slot, cue)}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: cue ? colors.accent : colors.surface2 }}
                    >
                      <Text style={{ fontWeight: '800', fontSize: 16, color: cue ? colors.onAccent : colors.text }}>{slot + 1}</Text>
                      <Text style={{ fontSize: 9, color: cue ? colors.onAccent : colors.sub }} numberOfLines={1}>{cue ? (cue.label ?? fmt(cue.position)) : '—'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ color: colors.sub, fontSize: 11 }}>空のパッドを押すと、いまの位置を保存します。押すとジャンプ、長押しで、更新・名前・削除ができます。</Text>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>スタート／エンド位置</Text>
              <Text style={{ color: p.trim ? colors.accentText : colors.sub, fontSize: 13 }}>
                {p.trim ? `再生範囲: ${p.trim.startSec !== undefined ? fmt(p.trim.startSec) : '最初'} 〜 ${p.trim.endSec !== undefined ? fmt(p.trim.endSec) : '最後'}` : 'まだ設定していません（曲の全体を再生します）'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {([['スタートを、いまの位置に', trimStart], ['エンドを、いまの位置に', trimEnd]] as const).map(([label, fn]) => (
                  <Pressable key={label} onPress={() => void fn()} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface2 }}>
                    <Text style={{ color: colors.text, fontSize: 13 }}>{label}</Text>
                  </Pressable>
                ))}
                {p.trim && (
                  <Pressable onPress={() => void p.clearTrim()} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface2 }}>
                    <Text style={{ color: colors.danger, fontSize: 13 }}>解除</Text>
                  </Pressable>
                )}
              </View>
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>フェードつなぎ</Text>
              <Text style={{ color: colors.sub, fontSize: 13 }}>
                いまの設定: {fadeSeconds > 0 ? `${fadeSeconds}秒` : 'オフ'}（設定 → 再生 で変更）
              </Text>
            </View>
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
          <Pressable hitSlop={12} onPress={() => void toggleLikeSong(song)}>
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

        {(p.loop || p.loopA !== undefined) && (
          <Pressable onPress={() => setView('dj')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
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
    </Animated.View>
  );
}
