import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, Switch, Text } from 'react-native';

import { describeSummary } from '../core/backup';
import { describeReport } from '../db/backup';
import { ensureBackupFolder, whereBackups } from '../player/backupFiles';
import { applyBackupPreferences, listBackupFiles, makeBackup, openBackup, restoreBackup } from '../state/backup';
import { showActionSheet } from './dialogs';
import { Row, Section } from './SettingsParts';
import { colors, useScheme } from './theme';

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Settings → バックアップ: write the library into a file, and put a file back (it only ever ADDS – nothing is deleted). */
export function BackupSection() {
  useScheme();
  const [events, setEvents] = useState(true);
  const [withSettings, setWithSettings] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await makeBackup({ events, withSettings });
      const body = `${r.name}\n${describeSummary(r.summary)}\n\n保存した場所: ${whereBackups()}`;
      if (r.shareable) {
        Alert.alert('バックアップを作りました', body, [
          { text: '共有・保存…', onPress: () => void Share.share({ url: r.uri }).catch(() => undefined) },
          { text: 'OK', style: 'cancel' },
        ]);
      } else {
        Alert.alert('バックアップを作りました', body);
      }
    } catch (e) {
      Alert.alert('作れませんでした', message(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await ensureBackupFolder())) return;
      const files = await listBackupFiles();
      if (!files.length) {
        Alert.alert('バックアップが見つかりません', `次の場所に、バックアップのファイル（.json）を置いてください。\n${whereBackups()}`);
        return;
      }
      const shown = files.slice(0, 8);
      showActionSheet({ title: 'どのバックアップから戻しますか？', message: files.length > shown.length ? `新しい ${shown.length}件を表示しています` : undefined, options: [...shown.map((f) => f.name), 'キャンセル'], cancelButtonIndex: shown.length }, (i) => {
        if (i < shown.length) void confirm(shown[i]);
      });
    } catch (e) {
      Alert.alert('探せませんでした', message(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (entry: { name: string; uri: string }) => {
    setBusy(true);
    try {
      const opened = await openBackup(entry);
      if (!opened.ok) {
        Alert.alert('読み込めません', opened.error);
        return;
      }
      const lines = [`ファイルの中身: ${describeSummary(opened.summary)}`, '', '取り込むと、こうなります:', ...describeReport(opened.preview).map((l) => `・${l}`), '', 'いまのデータは、消えません（足りないものだけを、追加します）。', ...(opened.warnings.length ? ['', ...opened.warnings.map((w) => `※ ${w}`)] : [])];
      Alert.alert('取り込む内容の確認', lines.join('\n'), [
        { text: '取り込む', onPress: () => void run(opened) },
        { text: 'やめる', style: 'cancel' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const run = async (opened: Extract<Awaited<ReturnType<typeof openBackup>>, { ok: true }>) => {
    setBusy(true);
    try {
      const report = await restoreBackup(opened.backup);
      const done = () => Alert.alert('取り込みました', describeReport(report).join('\n'));
      if (opened.backup.settings || opened.backup.theme) {
        Alert.alert('設定とテーマも戻しますか？', 'バックアップに入っていた設定（再生速度、音質、フェード、色など）で、いまの設定を置き換えます。', [
          { text: '戻す', onPress: () => { applyBackupPreferences(opened.backup); done(); } },
          { text: '戻さない', style: 'cancel', onPress: done },
        ]);
      } else {
        done();
      }
    } catch (e) {
      Alert.alert('取り込めませんでした', `${message(e)}\n\n途中で止まったので、何も変わっていません。`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="バックアップ">
      <Row title="再生履歴も含める" sub="統計や、よく聴く曲のもとになります（ファイルが大きくなります）">
        <Switch testID="backup-events" value={events} onValueChange={setEvents} trackColor={{ true: colors.accent }} />
      </Row>
      <Row title="設定とテーマも含める" sub="音質、フェードなどの好みと、色です。キーやサーバーの設定は、含めません">
        <Switch testID="backup-settings" value={withSettings} onValueChange={setWithSettings} trackColor={{ true: colors.accent }} />
      </Row>
      <Pressable testID="backup-create" onPress={() => void create()} disabled={busy}>
        <Row title="バックアップを作る" sub={`お気に入り、プレイリスト、スマートプレイリスト、タグ、キュー、BPM など。端末に保存した曲のファイルは含みません。\n保存先: ${whereBackups()}`}>
          {busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={{ color: colors.accentText, fontWeight: '700' }}>作る</Text>}
        </Row>
      </Pressable>
      <Pressable testID="backup-restore" onPress={() => void restore()} disabled={busy}>
        <Row title="バックアップから戻す" sub="取り込む前に、何が増えるかを確認できます。いまのデータは消えません" last>
          <Text style={{ color: colors.accentText, fontWeight: '700' }}>選ぶ</Text>
        </Row>
      </Pressable>
    </Section>
  );
}
