import { ActivityIndicator, Pressable, Text } from 'react-native';

import { otaMessage, runningLine } from '../core/ota';
import { useOta } from '../state/ota';
import { Row, Section } from './SettingsParts';
import { colors, useScheme } from './theme';

/** Settings → 中身の更新: shows which JavaScript runs, and lets you fetch an update or restart into it. */
export function OtaSection() {
  useScheme();
  const ota = useOta();
  const { snapshot } = ota;
  const pending = snapshot.enabled && snapshot.isUpdatePending;
  return (
    <Section title="中身の更新（IPA・APK を入れ直さずに）">
      <Row title="状態" sub={ota.note && snapshot.enabled && !pending ? ota.note : otaMessage(snapshot)} last={!snapshot.enabled} />
      {snapshot.enabled && (
        <>
          <Row title="いま動いている中身" sub={`${runningLine(ota.running)}${ota.runtimeVersion ? `\n互換番号 ${ota.runtimeVersion}` : ''}`} />
          <Pressable onPress={() => void ota.check()} disabled={ota.busy}>
            <Row title="更新を確認して取得" sub="起動のたびに自動でも確認します。取得した中身は、次の起動から使います" last={!pending}>
              {ota.busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={{ color: colors.accentText, fontWeight: '700' }}>確認</Text>}
            </Row>
          </Pressable>
          {pending && (
            <Pressable onPress={ota.restart}>
              <Row title="再起動して反映" sub="再生中の音楽は止まります" last>
                <Text style={{ color: colors.accentText, fontWeight: '700' }}>再起動</Text>
              </Row>
            </Pressable>
          )}
        </>
      )}
    </Section>
  );
}
