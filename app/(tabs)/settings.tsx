import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { runSelfTest, StepResult } from '../../src/core/diagnostics';
import { runCurrentSongProbe, runPlaybackProbe, runRealPathTest, runTokenExperiment } from '../../src/player/probe';

import type { StreamBackend } from '../../src/core/streams/resolver';
import { clearStreamCache } from '../../src/core';
import { useSettings, DEFAULT_SETTINGS } from '../../src/state/settings';
import { s } from '../../src/ui/components';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

const ORDERS: { label: string; value: StreamBackend[] }[] = [
  { label: 'YouTube (PO token) → Piped → Invidious', value: ['webpot', 'piped', 'invidious'] },
  { label: 'Piped → Invidious → YouTube (PO token)', value: ['piped', 'invidious', 'webpot'] },
  { label: 'YouTube (PO token) only', value: ['webpot'] },
];

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        {!!sub && <Text style={s.sub}>{sub}</Text>}
      </View>
      {children}
    </View>
  );
}

function Field({ label, value, onSave, multiline }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean }) {
  const [v, setV] = useState(value);
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      <Text style={s.sub}>{label}</Text>
      <TextInput value={v} onChangeText={setV} onEndEditing={() => onSave(v.trim())} multiline={multiline} autoCapitalize="none" autoCorrect={false}
        style={{ color: colors.text, backgroundColor: colors.surface2, borderRadius: 8, padding: 10, marginTop: 4 }} />
    </View>
  );
}

export default function Settings() {
  const st = useSettings();
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  const orderIdx = Math.max(0, ORDERS.findIndex((o) => o.value.join() === st.streamOrder.join()));

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: MINI_HEIGHT + 40 }}>
      <Text style={[s.h2, { marginTop: 8 }]}>Playback</Text>
      <Row title="Autoplay similar songs" sub="Continue with a radio when the queue ends">
        <Switch value={st.autoRadio} onValueChange={(v) => st.update({ autoRadio: v })} trackColor={{ true: colors.accent }} />
      </Row>
      <Row title="Fetch lyrics automatically" sub="LRCLIB, then KuGou">
        <Switch value={st.autoLyrics} onValueChange={(v) => st.update({ autoLyrics: v })} trackColor={{ true: colors.accent }} />
      </Row>
      <Pressable onPress={() => { clearStreamCache(); st.update({ streamOrder: ORDERS[(orderIdx + 1) % ORDERS.length].value }); }}>
        <Row title="Stream source order" sub={`${ORDERS[orderIdx].label}  (tap to change)`}><Text style={{ color: colors.accent }}>Change</Text></Row>
      </Pressable>

      <Text style={[s.h2, { marginTop: 20 }]}>Stream server (optional fallback)</Text>
      <Text style={[s.sub, { paddingHorizontal: 16 }]}>
        Only needed if playback on the phone alone does not work. Run server/server.mjs on your PC (see README) and enter its address here, e.g. http://192.168.1.10:8787
      </Text>
      <Field label="Server URL" value={st.streamServerUrl} onSave={(v) => { clearStreamCache(); st.update({ streamServerUrl: v }); }} />
      <Field label="Server key (optional)" value={st.streamServerKey} onSave={(v) => { clearStreamCache(); st.update({ streamServerKey: v }); }} />

      <Text style={[s.h2, { marginTop: 20 }]}>Region</Text>
      <Field label="Language (hl)" value={st.hl} onSave={(v) => st.update({ hl: v || 'en' })} />
      <Field label="Country (gl)" value={st.gl} onSave={(v) => st.update({ gl: (v || 'US').toUpperCase() })} />

      <Text style={[s.h2, { marginTop: 20 }]}>Advanced</Text>
      <Text style={[s.sub, { paddingHorizontal: 16 }]}>
        If search or playback suddenly fails, YouTube has probably retired the bundled client version. Update it here.
      </Text>
      <Field label="WEB_REMIX client version" value={st.webClientVersion} onSave={(v) => st.update({ webClientVersion: v || DEFAULT_SETTINGS.webClientVersion })} />
      <Field label="iOS client version" value={st.iosClientVersion} onSave={(v) => st.update({ iosClientVersion: v || DEFAULT_SETTINGS.iosClientVersion })} />
      <Field label="Piped instances (comma separated)" value={st.pipedInstances.join(', ')} multiline
        onSave={(v) => st.update({ pipedInstances: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
      <Field label="Invidious instances (comma separated)" value={st.invidiousInstances.join(', ')} multiline
        onSave={(v) => st.update({ invidiousInstances: v.split(',').map((x) => x.trim()).filter(Boolean) })} />

      <Text style={[s.h2, { marginTop: 20 }]}>Diagnostics</Text>
      <Text style={[s.sub, { paddingHorizontal: 16 }]}>Checks every stage of phone-only playback (WebView, PO token, solver, stream).</Text>
      <Pressable
        disabled={running}
        onPress={async () => {
          setSteps([]);
          setRunning(true);
          const add = (r: StepResult) => setSteps((cur) => [...cur, r]);
          if (await runSelfTest(add)) await runPlaybackProbe(add);
          setRunning(false);
        }}
      >
        <Row title={running ? 'Running…' : 'Run self-test'}><Text style={{ color: colors.accent }}>{running ? '' : 'Start'}</Text></Row>
      </Pressable>
      <Pressable
        disabled={running}
        onPress={async () => {
          setSteps([]);
          setRunning(true);
          await runRealPathTest((r) => setSteps((cur) => [...cur, r]));
          setRunning(false);
        }}
      >
        <Row title="Test real playback path" sub="Plays the current (or a test) song for 8 s and reports what AVPlayer does"><Text style={{ color: colors.accent }}>{running ? '' : 'Start'}</Text></Row>
      </Pressable>
      <Pressable
        disabled={running}
        onPress={async () => {
          setSteps([]);
          setRunning(true);
          await runCurrentSongProbe((r) => setSteps((cur) => [...cur, r]));
          setRunning(false);
        }}
      >
        <Row title="Test the current song" sub="Tap a song that fails in Search first, then run this"><Text style={{ color: colors.accent }}>{running ? '' : 'Start'}</Text></Row>
      </Pressable>
      <Pressable
        disabled={running}
        onPress={async () => {
          setSteps([]);
          setRunning(true);
          await runTokenExperiment((r) => setSteps((cur) => [...cur, r]));
          setRunning(false);
        }}
      >
        <Row title="Token experiment" sub="Which PO token does YouTube accept? (tap a failing song first)"><Text style={{ color: colors.accent }}>{running ? '' : 'Start'}</Text></Row>
      </Pressable>
      {steps.map((r) => (
        <View key={r.name} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
          <Text style={{ color: r.ok ? colors.accent : colors.danger, fontWeight: '600' }}>{r.ok ? '✓' : '✗'} {r.name} ({r.ms} ms)</Text>
          <Text selectable style={[s.sub, { fontSize: 12 }]}>{r.detail}</Text>
        </View>
      ))}

      <Pressable onPress={() => Alert.alert('Reset settings?', undefined, [{ text: 'Reset', style: 'destructive', onPress: st.reset }, { text: 'Cancel', style: 'cancel' }])}>
        <Row title="Reset settings"><Text style={{ color: colors.danger }}>Reset</Text></Row>
      </Pressable>

      <Text style={[s.sub, { padding: 16, marginTop: 12 }]}>
        RiMusic (TypeScript port) – licensed under GPL-3.0. Original project by fast4x.
      </Text>
    </ScrollView>
  );
}
