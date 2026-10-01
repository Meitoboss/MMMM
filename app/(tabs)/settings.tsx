import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useState } from 'react';

import type { StreamBackend } from '../../src/core/streams/resolver';
import { clearStreamCache } from '../../src/core';
import { useSettings, DEFAULT_SETTINGS } from '../../src/state/settings';
import { s } from '../../src/ui/components';
import { MINI_HEIGHT, colors } from '../../src/ui/theme';

const ORDERS: { label: string; value: StreamBackend[] }[] = [
  { label: 'YouTube → Piped → Invidious', value: ['innertube', 'piped', 'invidious'] },
  { label: 'Piped → Invidious → YouTube', value: ['piped', 'invidious', 'innertube'] },
  { label: 'Invidious → Piped → YouTube', value: ['invidious', 'piped', 'innertube'] },
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

      <Pressable onPress={() => Alert.alert('Reset settings?', undefined, [{ text: 'Reset', style: 'destructive', onPress: st.reset }, { text: 'Cancel', style: 'cancel' }])}>
        <Row title="Reset settings"><Text style={{ color: colors.danger }}>Reset</Text></Row>
      </Pressable>

      <Text style={[s.sub, { padding: 16, marginTop: 12 }]}>
        RiMusic (TypeScript port) – licensed under GPL-3.0. Original project by fast4x.
      </Text>
    </ScrollView>
  );
}
