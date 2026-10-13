import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useProgress } from 'react-native-track-player';

import { BEAT_CHOICES, MIN_TAPS, addTap, beatLoopRegion, beatSeconds, clampBpm, doubleBpm, effectiveBpm, estimateBpm, formatBpm, halveBpm, matchRate, parseBpmText } from '../core/beat';
import { HOT_CUE_SLOTS, type HotCue } from '../core/dj';
import { isLocalId } from '../core/localMeta';
import type { SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { useBpmOf, useSongBpm } from '../state/bpm';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { s } from './components';
import { promptText, showActionSheet } from './dialogs';
import { BeatLight, DjTimeline } from './DjTimeline';
import { colors, useScheme } from './theme';

const fmt = (sec: number): string => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, '0')}`;

/** a round button in the panel; `on` = the one that is active right now */
function Pill({ label, onPress, on = false, disabled = false, danger = false, testID }: { label: string; onPress: () => void; on?: boolean; disabled?: boolean; danger?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} disabled={disabled} onPress={onPress} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, opacity: disabled ? 0.4 : 1, backgroundColor: on ? colors.accent : colors.surface2 }}>
      <Text style={{ color: on ? colors.onAccent : danger ? colors.danger : colors.text, fontSize: 13, fontWeight: on ? '800' : '600' }}>{label}</Text>
    </Pressable>
  );
}

/** one block of the panel: a title, what it does in one line, then its controls */
function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  useScheme();
  return (
    <View style={[s.card, { padding: 16, gap: 12 }]}>
      <View style={{ gap: 3 }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{title}</Text>
        <Text style={{ color: colors.sub, fontSize: 12, lineHeight: 17 }}>{hint}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * The DJ tab of a song saved on this phone. The bar at the top shows the song; below it, five blocks:
 * tempo, loops, cue points, the start / end, and the fade. The last block matches the speed to the next song.
 * Every hint says exactly what its controls do. Messages stay inside the panel as a line of text – no pop-ups.
 */
export function DjPanel({ song }: { song: SongItem }) {
  useScheme();
  const loop = usePlayer((p) => p.loop);
  const loopA = usePlayer((p) => p.loopA);
  const trim = usePlayer((p) => p.trim);
  const rate = usePlayer((p) => p.rate);
  const tempo = usePlayer((p) => p.tempo);
  const playing = usePlayer((p) => p.status === 'playing');
  const next = usePlayer((p) => p.queue[p.index + 1]);
  const fadeSeconds = useSettings((st) => st.fadeSeconds);
  const progress = useProgress(150);
  const duration = progress.duration > 0 ? progress.duration : song.durationSec ?? 0;
  const { info, save } = useSongBpm(song);
  const nextBpm = useBpmOf(next);
  const [taps, setTaps] = useState<number[]>([]);
  const [cues, setCues] = useState<HotCue[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const estimate = estimateBpm(taps);
  const player = usePlayer.getState;

  // a new song starts with nothing pending
  useEffect(() => {
    setTaps([]);
    setNote(null);
  }, [song.id]);

  // cue points of this song
  useEffect(() => {
    let on = true;
    setCues([]);
    void openDb()
      .then((db) => repo.hotCues(db, song.id))
      .then((c) => on && setCues(c))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [song.id]);

  const fail = (e: unknown) => setNote(`うまくいきませんでした。${e instanceof Error ? e.message : String(e)}`);
  const saveBpm = (bpm: number, anchor = info?.anchor) => save({ bpm, ...(anchor !== undefined ? { anchor } : {}) }).then(() => setNote(null)).catch(fail);
  const needBpm = () => setNote('先に、この曲のテンポ（BPM）を決めてください。タップか、数字で入れられます。');
  const seekTo = (sec: number) => void player().seekTo(sec);

  // ---------------------------------------------------------------- tempo
  const setAnchor = async () => {
    if (!info) return needBpm();
    await saveBpm(info.bpm, await player().getPosition());
  };

  // ---------------------------------------------------------------- loops
  const startBeatLoop = async (beats: number) => {
    if (!info) return needBpm();
    const region = beatLoopRegion(await player().getPosition(), info, beats, duration || song.durationSec);
    if (!region) return setNote('ここからは、ループにできません。曲の終わりに近すぎます。');
    setNote(null);
    await player().loopRegion(region, { seek: false }); // the song keeps playing; at the end of the loop it goes back to the start
  };
  const loopBeats = loop && info ? Math.round(((loop.end - loop.start) / beatSeconds(info.bpm)) * 4) / 4 : null;

  // ---------------------------------------------------------------- cue points
  const reloadCues = async () => setCues(await repo.hotCues(await openDb(), song.id));
  const setCue = async (slot: number) => {
    try {
      await repo.setHotCue(await openDb(), song, slot, await player().getPosition());
      await reloadCues();
      setNote(null);
    } catch (e) {
      fail(e);
    }
  };
  /** go to a cue; a paused song starts playing */
  const jumpCue = async (c: HotCue) => {
    await player().seekTo(c.position);
    if (usePlayer.getState().status === 'paused') await usePlayer.getState().togglePlay();
  };
  const cueMenu = (slot: number, cue: HotCue) =>
    showActionSheet(
      { title: `キュー ${slot + 1}`, message: `${fmt(cue.position)}${cue.label ? `・${cue.label}` : ''}`, options: ['いまの位置に更新', '名前を付ける', '削除', 'キャンセル'], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
      (i) => {
        if (i === 0) void setCue(slot);
        else if (i === 1)
          promptText('キューの名前', undefined, cue.label ?? '', async (v) => {
            try {
              await repo.setHotCue(await openDb(), song, slot, cue.position, v);
              await reloadCues();
            } catch (e) {
              fail(e);
            }
          });
        else if (i === 2) void openDb().then((db) => repo.deleteHotCue(db, song.id, slot)).then(reloadCues).catch(fail);
      },
    );

  // ---------------------------------------------------------------- start / end
  const trimMessage = () => setNote('スタートは曲の始めの0.5秒より後、エンドは曲の終わりより前にしてください。2つの間は1秒以上あけます。');
  const trimStart = async () => {
    const kept = await player().markTrimStart(await player().getPosition());
    if (kept?.startSec === undefined) trimMessage();
    else setNote(null);
  };
  const trimEnd = async () => {
    const kept = await player().markTrimEnd(await player().getPosition());
    if (kept?.endSec === undefined) trimMessage();
    else setNote(null);
  };

  // ---------------------------------------------------------------- matching the next song (both on the phone)
  const nextIsLocal = !!next && isLocalId(next.id);
  const match = info && nextIsLocal && nextBpm ? matchRate(info.bpm, nextBpm.bpm) : null;
  const heard = info ? effectiveBpm(info.bpm, tempo ?? rate) : null;

  return (
    <View style={{ gap: 14 }}>
      {/* ------------------------------------------------------------ the song as a bar */}
      <View style={[s.card, { padding: 16, gap: 10 }]}>
        <DjTimeline duration={duration} position={progress.position} loop={loop} loopA={loopA} trim={trim} cues={cues} onSeek={seekTo} />
        <Text style={{ color: colors.sub, fontSize: 11 }}>バーをタップすると、その位置へ移動します。上の数字はキューです。</Text>
        <BeatLight info={info} position={progress.position} playing={playing} />
      </View>

      {!!note && (
        <View testID="dj-note" style={{ padding: 12, borderRadius: 12, backgroundColor: colors.surface2 }}>
          <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18 }}>{note}</Text>
        </View>
      )}

      {/* ------------------------------------------------------------ tempo */}
      <Block title="テンポ（BPM）" hint="曲に合わせて拍のたびにタップすると、テンポが出ます。数字で入れることもできます。テンポは、拍ループと、次の曲へのテンポ合わせに使われます。">
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <Text testID="bpm-value" style={{ color: info ? colors.accentText : colors.sub, fontSize: 34, fontWeight: '800' }}>{info ? formatBpm(info.bpm) : '未設定'}</Text>
          {!!info && <Text style={{ color: colors.sub, fontSize: 13 }}>BPM</Text>}
          {!!info && heard !== null && Math.abs(heard - info.bpm) >= 0.1 && <Text style={{ color: colors.sub, fontSize: 12 }}>いま聞こえる速さ {formatBpm(heard)}</Text>}
        </View>

        <Pressable testID="bpm-tap" onPress={() => setTaps((t) => addTap(t, Date.now()))} style={{ paddingVertical: 18, borderRadius: 14, alignItems: 'center', backgroundColor: colors.surface2 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>タップ</Text>
          <Text testID="bpm-tap-status" style={{ color: estimate ? colors.accentText : colors.sub, fontSize: 12, marginTop: 4 }}>
            {estimate ? `推定 ${formatBpm(estimate.bpm)} BPM（${estimate.taps}回）` : taps.length ? `あと ${Math.max(1, MIN_TAPS - taps.length)}回以上叩いてください` : '拍のたびに叩きます'}
          </Text>
        </Pressable>
        {taps.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!!estimate && <Pill testID="bpm-save-estimate" label={`${formatBpm(estimate.bpm)} を保存`} on onPress={() => { void saveBpm(estimate.bpm); setTaps([]); }} />}
            <Pill label="やり直す" onPress={() => setTaps([])} />
          </View>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pill label="÷2" disabled={!info} onPress={() => info && void saveBpm(halveBpm(info.bpm))} />
          <Pill label="−0.1" disabled={!info} onPress={() => info && void saveBpm(clampBpm(info.bpm - 0.1))} />
          <Pill label="＋0.1" disabled={!info} onPress={() => info && void saveBpm(clampBpm(info.bpm + 0.1))} />
          <Pill label="×2" disabled={!info} onPress={() => info && void saveBpm(doubleBpm(info.bpm))} />
          <Pill
            testID="bpm-type"
            label="数字で入力"
            onPress={() =>
              promptText('BPM を入力', '30〜300（小数点は2桁まで）', info ? formatBpm(info.bpm) : '', (v) => {
                const n = parseBpmText(v);
                if (n === null) setNote('BPM は 30〜300 の数字で入れてください。');
                else void saveBpm(n);
              })
            }
          />
          {!!info && <Pill testID="bpm-clear" label="テンポを消す" danger onPress={() => void save(null).then(() => setNote(null)).catch(fail)} />}
        </View>
        <Text style={{ color: colors.sub, fontSize: 12 }}>テンポが半分や倍に出たときは、÷2 と ×2 で直せます。</Text>

        <Pill testID="bpm-anchor" label="いまの位置を拍の位置にする" onPress={() => void setAnchor()} />
        <Text testID="bpm-anchor-status" style={{ color: info?.anchor !== undefined ? colors.accentText : colors.sub, fontSize: 12 }}>
          {info?.anchor !== undefined ? `拍の位置: ${fmt(info.anchor)}。拍ループと光る拍は、この位置を基準にします。` : '拍の位置が未設定です。拍ループは、押した位置から始まります。'}
        </Text>
      </Block>

      {/* ------------------------------------------------------------ loops */}
      <Block title="ループ" hint="Aで区間の始め、Bで終わりを押すと、その区間を繰り返します。拍ループは、いまの位置に近い拍から、選んだ拍数の長さを繰り返します（テンポが必要です）。">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pill testID="loop-a" label="A" on={loopA !== undefined || !!loop} onPress={async () => player().markLoopA(await player().getPosition())} />
          <Pill testID="loop-b" label="B" disabled={loopA === undefined} on={!!loop} onPress={async () => player().markLoopB(await player().getPosition())} />
          <Text style={{ flex: 1, color: loop || loopA !== undefined ? colors.accentText : colors.sub, fontSize: 12 }} numberOfLines={2}>
            {loop ? `ループ中 ${fmt(loop.start)} – ${fmt(loop.end)}` : loopA !== undefined ? `A ${fmt(loopA)}。終わりの位置で B を押してください` : 'まだ区間はありません'}
          </Text>
          {(loop || loopA !== undefined) && (
            <Pressable hitSlop={10} onPress={() => player().clearLoop()}>
              <Ionicons name="close-circle" size={24} color={colors.sub} />
            </Pressable>
          )}
        </View>

        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>拍ループ{loopBeats !== null ? `（${loopBeats}拍）` : ''}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {BEAT_CHOICES.map((n) => (
            <Pill key={n} testID={`beat-${n}`} label={`${n}拍`} disabled={!info} on={loopBeats === n} onPress={() => void startBeatLoop(n)} />
          ))}
        </View>
        {loop && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill testID="loop-half" label="半分の長さ" onPress={() => player().scaleLoop(0.5)} />
            <Pill testID="loop-double" label="2倍の長さ" onPress={() => player().scaleLoop(2)} />
          </View>
        )}
      </Block>

      {/* ------------------------------------------------------------ cue points */}
      <Block title="キュー" hint="空きを押すと、いまの位置を登録します。登録済みを押すと、そこへ移動します（止まっていれば再生します）。長押しで、位置の更新・名前の変更・削除ができます。">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Array.from({ length: HOT_CUE_SLOTS }, (_, slot) => {
            const cue = cues.find((c) => c.slot === slot);
            return (
              <Pressable
                key={slot}
                testID={`cue-${slot}`}
                onPress={() => (cue ? void jumpCue(cue) : void setCue(slot))}
                onLongPress={() => cue && cueMenu(slot, cue)}
                style={{ width: '23%', flexGrow: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: cue ? colors.accent : colors.surface2 }}
              >
                <Text style={{ fontWeight: '800', fontSize: 16, color: cue ? colors.onAccent : colors.text }}>{slot + 1}</Text>
                <Text style={{ fontSize: 10, color: cue ? colors.onAccent : colors.sub }} numberOfLines={1}>{cue ? (cue.label ?? fmt(cue.position)) : '空き'}</Text>
              </Pressable>
            );
          })}
        </View>
      </Block>

      {/* ------------------------------------------------------------ start / end */}
      <Block title="スタートとエンド" hint="スタートの位置から再生し、エンドを過ぎると次の曲へ進みます（次の曲がなければ止まります）。スタートを変えたときは、次に曲を読み込んだときに効きます。">
        <Text testID="trim-status" style={{ color: trim ? colors.accentText : colors.sub, fontSize: 13 }}>
          {trim ? `${trim.startSec !== undefined ? fmt(trim.startSec) : '曲の始め'} 〜 ${trim.endSec !== undefined ? fmt(trim.endSec) : '曲の終わり'}` : '曲の全体を再生します'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pill testID="trim-start" label="スタートをここに" onPress={() => void trimStart()} />
          <Pill testID="trim-end" label="エンドをここに" onPress={() => void trimEnd()} />
          {trim?.startSec !== undefined && <Pill testID="trim-go-start" label="スタートへ移動" onPress={() => seekTo(trim.startSec ?? 0)} />}
          {trim && <Pill testID="trim-clear" label="元に戻す" danger onPress={() => void player().clearTrim()} />}
        </View>
      </Block>

      {/* ------------------------------------------------------------ fade */}
      <Block title="フェードつなぎ" hint="端末内の曲どうしを、自動で次へ進むとき、フェードアウトとフェードインでつなぎます。手動で次の曲に進んだときは、つなぎません。変更は、設定の「再生」で行います。">
        <Text testID="fade-status" style={{ color: fadeSeconds > 0 ? colors.accentText : colors.sub, fontSize: 13 }}>
          {fadeSeconds > 0 ? `いまの設定: ${fadeSeconds}秒` : 'いまの設定: オフ'}
        </Text>
      </Block>

      {/* ------------------------------------------------------------ next song */}
      <Block title="次の曲にテンポを合わせる" hint="次の曲も端末内にあるときに使えます。この曲の速さを変えて、次の曲のテンポに合わせます。速さは、この曲だけに効き、次の曲では元の速さに戻ります。">
        {!next ? (
          <Text style={{ color: colors.sub, fontSize: 12 }}>キューに次の曲がありません。</Text>
        ) : !nextIsLocal ? (
          <Text style={{ color: colors.sub, fontSize: 12 }}>次の曲は端末内にないので、テンポは合わせられません。</Text>
        ) : (
          <>
            <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>次の曲: {next.title}</Text>
            <Text testID="next-bpm" style={{ color: nextBpm ? colors.accentText : colors.sub, fontSize: 12 }}>
              {nextBpm ? `${formatBpm(nextBpm.bpm)} BPM` : 'テンポが未設定です（次の曲のテンポを決めてください）'}
            </Text>
            {!!info && !!nextBpm && !match && <Text style={{ color: colors.sub, fontSize: 12 }}>テンポが離れすぎていて、速さを変えても合いません。</Text>}
            {match && (
              <>
                <Text testID="match-text" style={{ color: colors.text, fontSize: 12, lineHeight: 18 }}>
                  速さを ×{match.rate.toFixed(3)} にすると、{formatBpm(nextBpm!.bpm)} BPM に合います。{match.far ? '変化が大きいので、音が不自然になるかもしれません。' : ''}
                </Text>
                <Pill testID="match-apply" label={`この曲を ×${match.rate.toFixed(3)} で再生`} on={tempo === match.rate} onPress={() => void player().setTempo(match.rate)} />
              </>
            )}
          </>
        )}
        {tempo !== null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text testID="tempo-status" style={{ color: colors.accentText, fontSize: 12 }}>この曲だけ ×{tempo.toFixed(3)}</Text>
            <Pill testID="tempo-reset" label="元の速さに戻す" onPress={() => void player().setTempo(null)} />
          </View>
        )}
      </Block>
    </View>
  );
}
