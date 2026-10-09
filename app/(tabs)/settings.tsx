import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { clearStreamCache } from '../../src/core';
import { runSelfTest, runTokenServerTest, StepResult } from '../../src/core/diagnostics';
import type { StreamBackend } from '../../src/core/streams/resolver';
import { runCurrentSongProbe, runFormatMatrix, runPlaybackProbe, runRealPathTest, runTokenExperiment } from '../../src/player/probe';
import { usePlayer } from '../../src/state/player';
import { useUpdate } from '../../src/state/update';
import { DEFAULT_SETTINGS, useSettings } from '../../src/state/settings';
import { s } from '../../src/ui/components';
import { APP_VERSION } from '../../src/appVersion';
import { FADE_OPTIONS } from '../../src/core/dj';
import { type AudioQuality } from '../../src/core/config';
import { type NormalizeMode } from '../../src/core/loudness';
import { QUALITY_LABELS, qualitiesFor } from '../../src/core/streams/quality';
import { MINI_HEIGHT, colors, useScheme } from '../../src/ui/theme';
import { Chips, Row, Section } from '../../src/ui/SettingsParts';
import { BackupSection } from '../../src/ui/BackupSection';
import { OtaSection } from '../../src/ui/OtaSection';
import { ThemeEditor } from '../../src/ui/ThemeEditor';
import { generateSecretKey, exportLikedSongs, exportOfflineMp3 } from '../../src/ui/exportActions';

const ORDERS: { label: string; value: StreamBackend[] }[] = [
  { label: 'YouTube（トークン）→ Piped → Invidious', value: ['webpot', 'piped', 'invidious'] },
  { label: 'Piped → Invidious → YouTube（トークン）', value: ['piped', 'invidious', 'webpot'] },
  { label: 'YouTube（トークン）のみ', value: ['webpot'] },
];

/** what is offered depends on the phone: "高音質" only exists on Android */
const QUALITY_CHOICES: { label: string; value: AudioQuality }[] = qualitiesFor(Platform.OS === 'android' ? 'android' : 'ios').map((q) => ({ label: QUALITY_LABELS[q], value: q }));

const VOLUME_OPTIONS: { label: string; value: NormalizeMode }[] = [
  { label: 'オフ', value: 'off' },
  { label: '弱め', value: 'light' },
  { label: '標準', value: 'standard' },
];

const FADE_CHOICES: { label: string; value: number }[] = FADE_OPTIONS.map((v) => ({ label: v === 0 ? 'オフ' : `${v}秒`, value: v }));

const SLEEP_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: 'OFF', minutes: null },
  { label: '15分', minutes: 15 },
  { label: '30分', minutes: 30 },
  { label: '60分', minutes: 60 },
];
const SPEEDS = [0.75, 1, 1.25, 1.5];

function Field({ label, value, onSave, multiline, secure }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean; secure?: boolean }) {
  useScheme();
  const [v, setV] = useState(value);
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={s.sub}>{label}</Text>
      <TextInput
        value={v}
        onChangeText={setV}
        onEndEditing={() => onSave(v.trim())}
        multiline={multiline}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.sub}
        style={{ color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, padding: 10, marginTop: 6 }}
      />
    </View>
  );
}

function Action({ title, sub, onPress, disabled, right }: { title: string; sub?: string; onPress: () => void; disabled?: boolean; right?: string }) {
  useScheme();
  return (
    <Pressable onPress={onPress} disabled={disabled}>
      <Row title={title} sub={sub}>
        <Text style={{ color: colors.accentText, fontWeight: '700' }}>{disabled ? '実行中…' : right ?? '実行'}</Text>
      </Row>
    </Pressable>
  );
}

function Results({ steps }: { steps: StepResult[] }) {
  useScheme();
  if (!steps.length) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
      {steps.map((r) => (
        <View key={r.name}>
          <Text style={{ color: r.ok ? colors.accentText : colors.danger, fontWeight: '700' }}>
            {r.ok ? '✓' : '✗'} {r.name}{r.ms ? ` (${r.ms} ms)` : ''}
          </Text>
          <Text selectable style={[s.sub, { fontSize: 12 }]}>{r.detail}</Text>
        </View>
      ))}
    </View>
  );
}


export default function Settings() {
  useScheme();
  const st = useSettings();
  const rate = usePlayer((p) => p.rate);
  const setRate = usePlayer((p) => p.setRate);
  const setSleepTimer = usePlayer((p) => p.setSleepTimer);
  const [sleepMin, setSleepMin] = useState<number | null>(null);
  const [tab, setTab] = useState<'general' | 'theme'>('general');
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [tokenSteps, setTokenSteps] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const orderIdx = Math.max(0, ORDERS.findIndex((o) => o.value.join() === st.streamOrder.join()));

  /** Runs a diagnostic and shows its steps as they arrive. */
  const runTests = async (set: (r: StepResult[]) => void, fn: (add: (r: StepResult) => void) => Promise<unknown>) => {
    let acc: StepResult[] = [];
    set([]);
    setRunning(true);
    try {
      await fn((r) => {
        acc = [...acc, r];
        set(acc);
      });
    } finally {
      setRunning(false);
    }
  };

  const upd = useUpdate();
  const updateStatus = !st.updateFeedUrl.trim()
    ? '上のURLを入れると、アプリを開くたびに、新しい版があるか確認します'
    : upd.result?.kind === 'newer'
      ? `新しい版 ${upd.result.feed.version} があります（今は ${APP_VERSION}）`
      : upd.result?.kind === 'current'
        ? `最新です（${APP_VERSION}）`
        : upd.result?.kind === 'error'
          ? upd.result.message
          : `いまの版は ${APP_VERSION} です`;

  return (
    <>
    <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: MINI_HEIGHT + 40 }}>
      <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 8, padding: 4, borderRadius: 14, backgroundColor: colors.surface2 }}>
        {([['general', '一般'], ['theme', 'テーマ']] as const).map(([key, label]) => (
          <Pressable key={key} onPress={() => setTab(key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: tab === key ? colors.surface : 'transparent' }}>
            <Text style={{ color: tab === key ? colors.text : colors.sub, fontWeight: tab === key ? '800' : '600' }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'theme' ? <ThemeEditor /> : (<>
      <Section title="再生">
        <Row title="類似曲を自動で再生" sub="キューが終わったら、似た曲を続けて流します">
          <Switch value={st.autoRadio} onValueChange={(v) => st.update({ autoRadio: v })} trackColor={{ true: colors.accent }} />
        </Row>
        <Row title="歌詞を自動で取得" sub="LRCLIB、KuGou の順に探します">
          <Switch value={st.autoLyrics} onValueChange={(v) => st.update({ autoLyrics: v })} trackColor={{ true: colors.accent }} />
        </Row>
        <Row title="音量の自動調整" sub="曲ごとの音量の差を小さくします（大きい曲の音を下げます）。次の曲から反映されます" last />
        <Chips options={VOLUME_OPTIONS} value={st.volumeNormalize} onChange={(v) => st.update({ volumeNormalize: v })} />
        <Row
          title="音質"
          sub={`標準: 約128kbps（1時間で約58MB）\n節約: 約48kbps（約22MB）。曲によっては用意がなく、標準になります${Platform.OS === 'android' ? '\n高音質: 約130〜160kbps（約70MB）' : ''}\n切り替えは、次に再生する曲から。保存した曲は、保存したときの音質のままです`}
          last
        />
        <Chips
          options={QUALITY_CHOICES}
          value={st.audioQuality}
          onChange={(v) => {
            st.update({ audioQuality: v });
            clearStreamCache(); // already resolved songs would keep the old stream
          }}
        />
        <Row title="フェードつなぎ" sub="曲の終わりをフェードアウトして、次の曲をフェードインでつなぎます。曲は重ならないので、わずかな間ができます。自動で次の曲へ進むときだけ働きます" last />
        <Chips options={FADE_CHOICES} value={st.fadeSeconds} onChange={(v) => st.update({ fadeSeconds: v })} />
        <Row title="前回の続きから再生" sub="アプリを閉じても、キューと再生位置を覚えています。起動しても、自動では再生しません">
          <Switch value={st.resumeOnLaunch} onValueChange={(v) => st.update({ resumeOnLaunch: v })} trackColor={{ true: colors.accent }} />
        </Row>
        <Row title="スリープタイマー" sub="指定した時間が経つと、再生を止めます" last />
        <Chips
          options={SLEEP_OPTIONS.map((o) => ({ label: o.label, value: o.minutes }))}
          value={sleepMin}
          onChange={(m) => { setSleepMin(m); setSleepTimer(m); }}
        />
        <Row title="再生速度" last />
        <Chips options={SPEEDS.map((x) => ({ label: `${x}×`, value: x }))} value={rate} onChange={(x) => void setRate(x)} />
      </Section>

      <Section title="トークンサーバー">
        <Row title="YouTubeの再生に必要なトークンを、サーバーに作ってもらいます" sub="音声そのものは、この端末がYouTubeから直接取得します。未設定でも使えます。" />
        <Field label="サーバーのURL（https://…）" value={st.potServerUrl} onSave={(v) => { clearStreamCache(); st.update({ potServerUrl: v }); }} />
        <Field label="キー" value={st.potServerKey} secure onSave={(v) => { clearStreamCache(); st.update({ potServerKey: v }); }} />
        <Action title="接続テスト" sub="届くか、キーが合っているか、トークンを作れるかを確認します" disabled={running} onPress={() => void runTests(setTokenSteps, runTokenServerTest)} right="テスト" />
        <Results steps={tokenSteps} />
      </Section>

      <BackupSection />

      <OtaSection />

      <Section title="新しい版のお知らせ（IPA・APK）">
        <Field label="更新情報のURL（version.json）" value={st.updateFeedUrl} onSave={(v) => st.update({ updateFeedUrl: v })} />
        <Pressable onPress={() => void upd.check(true)}>
          <Row title="新しい版を確認" sub={updateStatus} last>
            {upd.checking ? <ActivityIndicator color={colors.accentText} /> : <Text style={{ color: colors.accentText, fontWeight: '700' }}>確認</Text>}
          </Row>
        </Pressable>
      </Section>

      <Section title="保存した曲をエクスポート">
        <Row title="秘密のキー" sub="このキーで、保存した曲をファイルに出力できます。新しいキーを生成すると、前のキーは使えなくなります。" />
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text selectable style={{ fontFamily: 'monospace', color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, padding: 10, fontSize: 12 }}>{st.secretKey}</Text>
        </View>
        <Pressable onPress={() => Alert.alert('新しいキーを生成しますか？', '前のキーで出力したファイルは、新しいキーでは使えなくなります。', [{ text: '生成', style: 'destructive', onPress: () => st.update({ secretKey: generateSecretKey() }) }, { text: 'キャンセル', style: 'cancel' }])}>
          <Row title="新しいキーを生成">
            <Text style={{ color: colors.accentText, fontWeight: '700' }}>生成</Text>
          </Row>
        </Pressable>
        <Pressable onPress={() => void exportLikedSongs(st.secretKey)}>
          <Row title="保存した曲（リスト）をエクスポート" sub="保存した曲のリストを JSON ファイルで出力します">
            <Text style={{ color: colors.accentText, fontWeight: '700' }}>エクスポート</Text>
          </Row>
        </Pressable>
        <Pressable onPress={() => setShowKeyPrompt(true)}>
          <Row title="オフライン保存した曲（mp3）をエクスポート" sub="オフライン保存した曲を mp3 ファイルで出力します。秘密キーが必要です" last>
            <Text style={{ color: colors.accentText, fontWeight: '700' }}>エクスポート</Text>
          </Row>
        </Pressable>
      </Section>

      <Section title="詳細設定">
        <Pressable onPress={() => setOpen((o) => !o)}>
          <Row title={open ? '詳細設定を閉じる' : '詳細設定・診断を開く'} sub="通常は変更不要です。不具合があるときに使います。" last={!open}>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.sub} />
          </Row>
        </Pressable>

        {open && (
          <>
            <Row title="再生ログを表示" sub="プレイヤー画面に、再生の内部ログを出します">
              <Switch value={st.showDebug} onValueChange={(v) => st.update({ showDebug: v })} trackColor={{ true: colors.accent }} />
            </Row>
            <Pressable onPress={() => { clearStreamCache(); st.update({ streamOrder: ORDERS[(orderIdx + 1) % ORDERS.length].value }); }}>
              <Row title="取得元の優先順" sub={ORDERS[orderIdx].label}>
                <Text style={{ color: colors.accentText, fontWeight: '700' }}>変更</Text>
              </Row>
            </Pressable>
            <Field label="言語（hl）" value={st.hl} onSave={(v) => st.update({ hl: v || 'en' })} />
            <Field label="国（gl）" value={st.gl} onSave={(v) => st.update({ gl: (v || 'US').toUpperCase() })} />
            <Field label="WEB_REMIX クライアントのバージョン" value={st.webClientVersion} onSave={(v) => st.update({ webClientVersion: v || DEFAULT_SETTINGS.webClientVersion })} />
            <Field label="iOS クライアントのバージョン" value={st.iosClientVersion} onSave={(v) => st.update({ iosClientVersion: v || DEFAULT_SETTINGS.iosClientVersion })} />
            <Field label="Piped のインスタンス（カンマ区切り）" value={st.pipedInstances.join(', ')} multiline onSave={(v) => st.update({ pipedInstances: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <Field label="Invidious のインスタンス（カンマ区切り）" value={st.invidiousInstances.join(', ')} multiline onSave={(v) => st.update({ invidiousInstances: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <Field label="ストリームサーバーのURL（任意・PC上のyt-dlp用）" value={st.streamServerUrl} onSave={(v) => { clearStreamCache(); st.update({ streamServerUrl: v }); }} />
            <Field label="ストリームサーバーのキー" value={st.streamServerKey} secure onSave={(v) => { clearStreamCache(); st.update({ streamServerKey: v }); }} />

            <Row title="診断" sub="どの段階で止まっているかを調べます" />
            <Action title="自己診断" sub="WebView、トークン、解読、再生までを順に確認" disabled={running} onPress={() => void runTests(setSteps, async (add) => { if (await runSelfTest(add)) await runPlaybackProbe(add); })} />
            <Action title="実際の再生経路のテスト" sub="8秒間再生して、再生エンジンの状態を記録" disabled={running} onPress={() => void runTests(setSteps, runRealPathTest)} />
            <Action title="今の曲を調べる" sub="再生に失敗した曲をタップしてから実行" disabled={running} onPress={() => void runTests(setSteps, runCurrentSongProbe)} />
            <Action title="トークンの実験" sub="どのトークンが受け付けられるか" disabled={running} onPress={() => void runTests(setSteps, runTokenExperiment)} />
            <Action title="形式マトリクス" sub="どの形式（itag）が、どのトークンで通るか" disabled={running} onPress={() => void runTests(setSteps, runFormatMatrix)} />
            <Results steps={steps} />

            <Pressable onPress={() => Alert.alert('設定を初期化しますか？', undefined, [{ text: '初期化', style: 'destructive', onPress: st.reset }, { text: 'キャンセル', style: 'cancel' }])}>
              <Row title="設定を初期化" last>
                <Text style={{ color: colors.danger, fontWeight: '700' }}>初期化</Text>
              </Row>
            </Pressable>
          </>
        )}
      </Section>

      </>)}

      <View style={{ alignItems: 'center', paddingHorizontal: 24, paddingTop: 28, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>Music space</Text>
        <Text style={s.sub}>バージョン {APP_VERSION}</Text>
        <Text style={[s.sub, { textAlign: 'center', marginTop: 6 }]}>
        </Text>
      </View>
    </ScrollView>

    <Modal visible={showKeyPrompt} transparent animationType="fade" onRequestClose={() => setShowKeyPrompt(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: '80%', maxWidth: 300, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>秘密キーを入力</Text>
          <TextInput
            placeholder="秘密キー"
            placeholderTextColor={colors.sub}
            value={keyInput}
            onChangeText={setKeyInput}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={{ backgroundColor: colors.surface2, borderRadius: 8, padding: 12, color: colors.text, fontSize: 14 }}
          />
          <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <Pressable onPress={() => setShowKeyPrompt(false)}>
              <Text style={{ color: colors.sub, fontWeight: '600', padding: 8 }}>キャンセル</Text>
            </Pressable>
            <Pressable onPress={() => {
              if (keyInput) {
                void exportOfflineMp3(st.secretKey, keyInput);
                setShowKeyPrompt(false);
                setKeyInput('');
              }
            }}>
              <Text style={{ color: colors.accentText, fontWeight: '700', padding: 8 }}>エクスポート</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}
