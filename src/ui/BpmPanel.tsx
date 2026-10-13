import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { BEAT_CHOICES, MIN_TAPS, addTap, beatLoopRegion, beatSeconds, clampBpm, doubleBpm, effectiveBpm, estimateBpm, formatBpm, halveBpm, matchRate, parseBpmText } from '../core/beat';
import type { SongItem } from '../core/types';
import { useBpmOf, useSongBpm } from '../state/bpm';
import { usePlayer } from '../state/player';
import { promptText } from './dialogs';
import { colors, useScheme } from './theme';

const fmt = (sec: number): string => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, '0')}`;

function Pill({ label, onPress, on = false, disabled = false, danger = false, testID }: { label: string; onPress: () => void; on?: boolean; disabled?: boolean; danger?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} disabled={disabled} onPress={onPress} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, opacity: disabled ? 0.4 : 1, backgroundColor: on ? colors.accent : colors.surface2 }}>
      <Text style={{ color: on ? colors.onAccent : danger ? colors.danger : colors.text, fontSize: 13, fontWeight: on ? '800' : '600' }}>{label}</Text>
    </Pressable>
  );
}

const Title = ({ children }: { children: string }) => <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{children}</Text>;
const Hint = ({ children }: { children: string }) => <Text style={{ color: colors.sub, fontSize: 11 }}>{children}</Text>;

/**
 * DJ tab: the tempo of the song (typed, or tapped along), beat loops that start ON the beat, and the speed that matches the
 * next song. The app cannot hear the music – the tempo and the position of one beat are told by the person.
 */
export function BpmPanel({ song }: { song: SongItem }) {
  useScheme();
  const loop = usePlayer((p) => p.loop);
  const rate = usePlayer((p) => p.rate);
  const tempo = usePlayer((p) => p.tempo);
  const next = usePlayer((p) => p.queue[p.index + 1]);
  const { info, save } = useSongBpm(song);
  const nextBpm = useBpmOf(next);
  const [taps, setTaps] = useState<number[]>([]);
  const estimate = estimateBpm(taps);
  const player = usePlayer.getState;

  const failure = (e: unknown) => Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
  const saveBpm = (bpm: number, anchor = info?.anchor) => save({ bpm, ...(anchor !== undefined ? { anchor } : {}) }).catch(failure);
  const needBpm = () => Alert.alert('BPM が未設定です', '先に、この曲の BPM を設定してください（タップで測れます）。');

  const setAnchor = async () => {
    if (!info) return needBpm();
    await saveBpm(info.bpm, await player().getPosition());
  };

  const startLoop = async (beats: number) => {
    if (!info) return needBpm();
    const region = beatLoopRegion(await player().getPosition(), info, beats, song.durationSec);
    if (!region) return Alert.alert('ループにできません', '曲の終わりを越えるか、短すぎます。');
    await player().loopRegion(region, { seek: false }); // the song plays on; at the end of the loop it goes back to the start
  };

  const match = info && nextBpm ? matchRate(info.bpm, nextBpm.bpm) : null;
  const loopBeats = loop && info ? Math.round(((loop.end - loop.start) / beatSeconds(info.bpm)) * 4) / 4 : null;
  const heard = info ? effectiveBpm(info.bpm, tempo ?? rate) : null;

  return (
    <View style={{ gap: 20 }}>
      {/* ------------------------------------------------------------ tempo */}
      <View style={{ gap: 8 }}>
        <Title>テンポ（BPM）</Title>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
          <Text testID="bpm-value" style={{ color: info ? colors.accentText : colors.sub, fontSize: 30, fontWeight: '800' }}>{info ? formatBpm(info.bpm) : '未設定'}</Text>
          {!!info && <Text style={{ color: colors.sub, fontSize: 13 }}>BPM</Text>}
          {!!info && heard !== null && Math.abs(heard - info.bpm) >= 0.1 && <Text style={{ color: colors.sub, fontSize: 12 }}>いま聞こえるテンポ {formatBpm(heard)}</Text>}
        </View>

        <Pressable testID="bpm-tap" onPress={() => setTaps((t) => addTap(t, Date.now()))} style={{ paddingVertical: 22, borderRadius: 14, alignItems: 'center', backgroundColor: colors.surface2 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>タップ</Text>
          <Text testID="bpm-tap-status" style={{ color: estimate ? colors.accentText : colors.sub, fontSize: 12, marginTop: 4 }}>
            {estimate ? `推定 ${formatBpm(estimate.bpm)} BPM（${estimate.taps}回）` : taps.length ? `あと ${Math.max(1, MIN_TAPS - taps.length)}回以上` : '曲に合わせて、拍のたびに叩きます'}
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
                if (n === null) Alert.alert('BPM が正しくありません', '30〜300 の数字を入れてください。');
                else void saveBpm(n);
              })
            }
          />
          {!!info && <Pill label="BPM を消す" danger onPress={() => void save(null).catch(failure)} />}
        </View>
        <Hint>タップは「半分」や「倍」で測れることがあります。そのときは、÷2 と ×2 で直します。</Hint>

        <View style={{ gap: 6 }}>
          <Pill testID="bpm-anchor" label="いまの位置を、ビートの位置にする" onPress={() => void setAnchor()} />
          <Text testID="bpm-anchor-status" style={{ color: info?.anchor !== undefined ? colors.accentText : colors.sub, fontSize: 12 }}>
            {info?.anchor !== undefined ? `ビートの位置: ${fmt(info.anchor)}（拍ループが、ここを基準に、拍へ吸い付きます）` : 'ビートの位置が未設定: 拍ループは、押した位置から始まります'}
          </Text>
        </View>
      </View>

      {/* ------------------------------------------------------------ beat loops */}
      <View style={{ gap: 8 }}>
        <Title>拍ループ</Title>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {BEAT_CHOICES.map((n) => (
            <Pill key={n} testID={`beat-${n}`} label={`${n}拍`} disabled={!info} on={loopBeats === n} onPress={() => void startLoop(n)} />
          ))}
        </View>
        {loop ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text testID="beat-loop-status" style={{ color: colors.accentText, fontSize: 12 }}>
              ループ中 {fmt(loop.start)} – {fmt(loop.end)}{loopBeats !== null ? `（${loopBeats}拍）` : ''}
            </Text>
            <Pill testID="loop-half" label="½" onPress={() => player().scaleLoop(0.5)} />
            <Pill testID="loop-double" label="×2" onPress={() => player().scaleLoop(2)} />
            <Pill label="解除" danger onPress={() => player().clearLoop()} />
          </View>
        ) : (
          <Hint>{info ? '押した位置に近い拍から、その長さを繰り返します。曲は止まりません。' : 'BPM を設定すると、拍に合わせてループできます。'}</Hint>
        )}
      </View>

      {/* ------------------------------------------------------------ matching the next song */}
      <View style={{ gap: 8 }}>
        <Title>次の曲にテンポを合わせる</Title>
        {!next ? (
          <Hint>キューに次の曲がありません。</Hint>
        ) : (
          <>
            <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>次の曲: {next.title}</Text>
            <Text testID="next-bpm" style={{ color: nextBpm ? colors.accentText : colors.sub, fontSize: 12 }}>{nextBpm ? `${formatBpm(nextBpm.bpm)} BPM` : 'BPM が未設定です（その曲を再生して、設定してください）'}</Text>
            {!info && <Hint>この曲の BPM を設定してください。</Hint>}
            {info && nextBpm && !match && <Hint>テンポが離れすぎていて、速さを変えても合いません。</Hint>}
            {match && (
              <>
                <Text testID="match-text" style={{ color: colors.text, fontSize: 12 }}>
                  速さを ×{match.rate.toFixed(3)} にすると、{formatBpm(nextBpm!.bpm)} BPM に合います{match.via === 'half' ? `（次の曲を、半分のテンポ ${formatBpm(nextBpm!.bpm / 2)} BPM の拍として数えます）` : match.via === 'double' ? `（次の曲を、倍のテンポ ${formatBpm(nextBpm!.bpm * 2)} BPM の拍として数えます）` : ''}。
                  {match.far ? '変化が大きいので、音が不自然になるかもしれません。' : ''}
                </Text>
                <Pill testID="match-apply" label={`この曲の速さを ×${match.rate.toFixed(3)} にする`} on={tempo === match.rate} onPress={() => void player().setTempo(match.rate)} />
              </>
            )}
          </>
        )}
        {tempo !== null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text testID="tempo-status" style={{ color: colors.accentText, fontSize: 12 }}>この曲だけ ×{tempo.toFixed(3)}（次の曲では、元の速さに戻ります）</Text>
            <Pill testID="tempo-reset" label="元の速さに戻す" onPress={() => void player().setTempo(null)} />
          </View>
        )}
      </View>
    </View>
  );
}
