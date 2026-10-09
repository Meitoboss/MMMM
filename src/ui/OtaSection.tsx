import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { formatWhen, otaMessage, runningLine } from '../core/ota';
import { APPLY_MODES } from '../core/updater';
import { useOta } from '../state/ota';
import { useSettings } from '../state/settings';
import { useUpdater } from '../state/updater';
import { Row, Section } from './SettingsParts';
import { colors, useScheme } from './theme';

/** Settings → 中身の更新: shows which JavaScript runs, and lets you fetch an update or restart into it. */
export function OtaSection() {
  useScheme();
  const ota = useOta();
  const { snapshot } = ota;
  const mode = useSettings((s) => s.otaApplyMode);
  const update = useSettings((s) => s.update);
  const lastCheckAt = useUpdater((s) => s.lastCheckAt);
  const pending = snapshot.enabled && snapshot.isUpdatePending;
  return (
    <Section title="中身の更新（IPA・APK を入れ直さずに）">
      <Row title="状態" sub={ota.note && snapshot.enabled && !pending ? ota.note : otaMessage(snapshot)} last={!snapshot.enabled} />
      {snapshot.enabled && (
        <>
          <Row title="いま動いている中身" sub={`${runningLine(ota.running)}${ota.runtimeVersion ? `\n互換番号 ${ota.runtimeVersion}` : ''}`} />
          <Row title="反映のしかた" sub={APPLY_MODES.find((m) => m.value === mode)?.hint}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 220 }}>
              {APPLY_MODES.map((m) => (
                <Pressable key={m.value} testID={`apply-${m.value}`} onPress={() => update({ otaApplyMode: m.value })} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: mode === m.value ? colors.accent : colors.surface2 }}>
                  <Text style={{ color: mode === m.value ? colors.onAccent : colors.text, fontSize: 12, fontWeight: mode === m.value ? '800' : '600' }}>{m.label}</Text>
                </Pressable>
              ))}
            </View>
          </Row>
          <Pressable onPress={() => void ota.check()} disabled={ota.busy}>
            <Row title="更新を確認して取得" sub={`起動時、アプリに戻ったとき、開いている間も、自動で確認します。${lastCheckAt ? `\n最後の確認: ${formatWhen(lastCheckAt)}` : ''}`} last={!pending}>
              {ota.busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={{ color: colors.accentText, fontWeight: '700' }}>確認</Text>}
            </Row>
          </Pressable>
          {pending && (
            <Pressable testID="ota-apply" onPress={ota.restart}>
              <Row title="いま反映" sub="アプリを閉じずに、新しい版に切り替えます" last>
                <Text style={{ color: colors.accentText, fontWeight: '700' }}>反映</Text>
              </Row>
            </Pressable>
          )}
        </>
      )}
    </Section>
  );
}
