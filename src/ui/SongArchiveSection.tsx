import { useState } from 'react';
import { Alert, Pressable, Share, Switch, Text, View } from 'react-native';

import { checkSecretKey, KEY_ADVICE } from '../core/secretKey';
import { estimateSeconds, formatBytes, formatDuration, spaceNeeded } from '../core/songArchive';
import { listSongArchives, whereArchives } from '../player/songArchivePlatform';
import { type OpenedArchive, archiveErrorText, createSongArchive, isCancelledError, isWrongKeyError, openSongArchiveFile, restoreOpenedArchive, savedSongsSummary, useSongArchive } from '../state/songArchive';
import type { BackupEntry } from '../player/backupFiles';
import { promptSecret, showActionSheet } from './dialogs';
import { Row, Section } from './SettingsParts';
import { colors, useScheme } from './theme';

/** the bar and the words while a job runs */
function Progress() {
  useScheme();
  const p = useSongArchive();
  if (p.phase === 'idle') return null;
  const fraction = p.phase === 'key' ? p.keyProgress : p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : 0;
  const text =
    p.phase === 'key'
      ? `キーを準備しています… ${Math.round(p.keyProgress * 100)}%（わざと時間をかけています）`
      : `${p.phase === 'writing' ? 'ファイルに入れています' : '取り込んでいます'}… ${Math.min(p.done + 1, Math.max(p.total, 1))} / ${p.total} 曲（${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}）`;
  return (
    <View testID="archive-progress" style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14, backgroundColor: colors.surface2, gap: 8 }}>
      <Text style={{ color: colors.text, fontSize: 13 }}>{text}</Text>
      {!!p.title && p.phase !== 'key' && (
        <Text style={{ color: colors.sub, fontSize: 12 }} numberOfLines={1}>
          {p.title}
        </Text>
      )}
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
        <View testID="archive-bar" style={{ height: 6, width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`, backgroundColor: colors.accent }} />
      </View>
      <Text style={{ color: colors.sub, fontSize: 11 }}>画面を閉じたり、別のアプリに切り替えたりせずに、お待ちください。</Text>
      <Pressable testID="archive-cancel" onPress={p.cancel} disabled={p.cancelRequested} style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface, opacity: p.cancelRequested ? 0.5 : 1 }}>
        <Text style={{ color: colors.danger, fontWeight: '700' }}>{p.cancelRequested ? '中止しています…' : 'キャンセル'}</Text>
      </Pressable>
    </View>
  );
}

/** Settings → 保存した曲のバックアップ（暗号化）: the saved songs in one file that only the secret key opens */
export function SongArchiveSection() {
  useScheme();
  const [withLibrary, setWithLibrary] = useState(true);
  const phase = useSongArchive((s) => s.phase);
  const busy = phase !== 'idle';

  /* ---------------------------------------------------------------- into a file */
  const askNewKey = (onKey: (key: string) => void) => {
    const ask = () =>
      promptSecret('秘密のキーを決める', KEY_ADVICE.join('\n\n'), (k1) => {
        const c = checkSecretKey(k1);
        if (!c.ok) {
          Alert.alert('このキーは使えません', c.problems.join('\n'), [{ text: 'もう一度', onPress: ask }, { text: 'やめる', style: 'cancel' }]);
          return;
        }
        promptSecret('もう一度、同じキーを入力', '確認のためです。', (k2) => {
          if (k2 !== k1) {
            Alert.alert('2回のキーが、一致しません', '同じキーを、2回入力してください。', [{ text: 'もう一度', onPress: ask }, { text: 'やめる', style: 'cancel' }]);
            return;
          }
          onKey(k1);
        });
      });
    ask();
  };

  const create = async () => {
    if (busy) return;
    let summary: { count: number; bytes: number };
    try {
      summary = await savedSongsSummary();
    } catch (e) {
      Alert.alert('調べられませんでした', archiveErrorText(e));
      return;
    }
    if (summary.count === 0 && !withLibrary) {
      Alert.alert('保存した曲がありません', 'オフライン用に保存した曲が、まだありません。プレイリストなどだけを入れるには、「プレイリストなども入れる」を、オンにしてください。');
      return;
    }
    askNewKey((key) => {
      const body = [
        `保存した曲 ${summary.count}曲（${formatBytes(summary.bytes)}）を、秘密のキーで守ったファイルに入れます。`,
        withLibrary ? 'お気に入り、プレイリストなども、一緒に入れます。' : '',
        `時間は、${formatDuration(estimateSeconds(summary.bytes))}が目安です（機種によります）。`,
        `保存先: ${whereArchives()}`,
        '',
        'キーは、パスワード管理アプリなどに、控えましたか？忘れると、誰にもファイルを開けません。',
      ]
        .filter((l, i) => l !== '' || i > 0)
        .join('\n');
      Alert.alert('ファイルに入れます', body, [{ text: 'はじめる', onPress: () => void run(key) }, { text: 'やめる', style: 'cancel' }]);
    });
  };

  const run = async (key: string) => {
    try {
      const r = await createSongArchive({ secretKey: key, withLibrary });
      const note = r.skipped ? `\n\nファイルが見つからなかった ${r.skipped}曲は、入っていません。` : '';
      const body = `${r.name}\n${r.included}曲（${formatBytes(r.bytes)}）\n\n保存した場所: ${whereArchives()}${note}\n\n別の端末に移すときは、このファイルと、秘密のキーが要ります。`;
      Alert.alert('ファイルに入れました', body, r.shareable ? [{ text: '共有・保存…', onPress: () => void Share.share({ url: r.uri }).catch(() => undefined) }, { text: 'OK', style: 'cancel' }] : [{ text: 'OK' }]);
    } catch (e) {
      if (isCancelledError(e)) Alert.alert('中止しました', '途中のファイルは、消しました。');
      else Alert.alert('入れられませんでした', `${archiveErrorText(e)}\n\n途中のファイルは、消しました。`);
    }
  };

  /* ---------------------------------------------------------------- back from a file */
  const restore = async () => {
    if (busy) return;
    let files: BackupEntry[];
    try {
      files = await listSongArchives();
    } catch (e) {
      Alert.alert('探せませんでした', archiveErrorText(e));
      return;
    }
    if (!files.length) {
      Alert.alert('ファイルが見つかりません', `保存した曲のファイル（.msbx）を、次の場所に置いてください。\n${whereArchives()}`);
      return;
    }
    const shown = files.slice(0, 8);
    showActionSheet({ title: 'どのファイルから戻しますか？', options: [...shown.map((f) => f.name), 'キャンセル'], cancelButtonIndex: shown.length }, (i) => {
      if (i < shown.length) askKey(shown[i]);
    });
  };

  const askKey = (entry: BackupEntry) =>
    promptSecret('秘密のキーを入力', entry.name, (key) => {
      void (async () => {
        try {
          confirm(await openSongArchiveFile(entry, key));
        } catch (e) {
          if (isCancelledError(e)) return;
          if (isWrongKeyError(e)) Alert.alert('開けません', archiveErrorText(e), [{ text: 'もう一度', onPress: () => askKey(entry) }, { text: 'やめる', style: 'cancel' }]);
          else Alert.alert('開けません', archiveErrorText(e));
        }
      })();
    });

  const confirm = (o: OpenedArchive) => {
    const m = o.manifest;
    const fresh = m.songs.length - o.alreadyIds.size;
    if (o.newBytes > 0 && o.freeBytes < spaceNeeded(o.newBytes)) {
      o.close();
      Alert.alert('空き容量が足りません', `戻すのに、${formatBytes(spaceNeeded(o.newBytes))}ほど必要です（いまの空き: ${formatBytes(o.freeBytes)}）。`);
      return;
    }
    const lines = [
      `${m.songs.length}曲（${formatBytes(m.totalBytes)}）が入っています。`,
      `・新しく戻す: ${fresh}曲（${formatBytes(o.newBytes)}）`,
      `・すでにあるので、飛ばす: ${o.alreadyIds.size}曲`,
      m.hasLibrary ? '・お気に入り、プレイリストなども、戻します（追加だけで、消しません）' : '',
      '',
      `時間は、${formatDuration(estimateSeconds(o.newBytes))}が目安です。いまの曲は、消えません。`,
    ].filter((l, i) => l !== '' || i > 0);
    Alert.alert('戻す内容の確認', lines.join('\n'), [{ text: '戻す', onPress: () => void doRestore(o) }, { text: 'やめる', style: 'cancel', onPress: o.close }], { cancelable: false });
  };

  const doRestore = async (o: OpenedArchive) => {
    try {
      const r = await restoreOpenedArchive(o);
      const lines = [`${r.restored}曲を戻しました（${formatBytes(r.bytes)}）。`, r.alreadyHad ? `すでにあった ${r.alreadyHad}曲は、そのままです。` : '', r.invalid ? `読み取れなかった ${r.invalid}件を、飛ばしました。` : '', r.libraryRestored ? 'お気に入り、プレイリストなども、戻しました。' : '', r.libraryError ? `※ プレイリストなどは、戻せませんでした（${r.libraryError}）。` : ''].filter(Boolean);
      Alert.alert('戻しました', lines.join('\n'));
    } catch (e) {
      if (isCancelledError(e)) Alert.alert('中止しました', '途中の曲のファイルは、消しました。それまでに戻した曲は、そのまま残っています。');
      else Alert.alert('戻せませんでした', `${archiveErrorText(e)}\n\n途中の曲のファイルは、消しました。それまでに戻した曲は、そのまま残っています。`);
    }
  };

  return (
    <Section title="保存した曲のバックアップ（暗号化）">
      <Progress />
      <Row title="プレイリストなども入れる" sub="お気に入り、プレイリスト、スマートプレイリスト、タグ、キューなど">
        <Switch testID="archive-library" value={withLibrary} onValueChange={setWithLibrary} trackColor={{ true: colors.accent }} />
      </Row>
      <Pressable testID="archive-create" onPress={() => void create()} disabled={busy}>
        <Row title="保存した曲を、ファイルに入れる" sub={`オフライン用に保存した曲を、元の音のまま、あなたが決める秘密のキーで守ったファイルに入れます。機種の変更や、バックアップに使えます。\n保存先: ${whereArchives()}`}>
          <Text style={{ color: busy ? colors.sub : colors.accentText, fontWeight: '700' }}>入れる</Text>
        </Row>
      </Pressable>
      <Pressable testID="archive-restore" onPress={() => void restore()} disabled={busy}>
        <Row title="ファイルから、保存した曲を戻す" sub="秘密のキーで開きます。すでにある曲は、そのままで、足りないものだけを戻します" last>
          <Text style={{ color: busy ? colors.sub : colors.accentText, fontWeight: '700' }}>選ぶ</Text>
        </Row>
      </Pressable>
    </Section>
  );
}
