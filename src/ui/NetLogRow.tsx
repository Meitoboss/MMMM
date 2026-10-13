import { Alert, Pressable, Share, Text } from 'react-native';

import { APP_VERSION } from '../appVersion';
import { dialogLines, shareText, summarize } from '../core/netlog';
import { clearNetLog, useNetLog } from '../state/netlog';
import { Row } from './SettingsParts';
import { colors, useScheme } from './theme';

/** Settings → トークンサーバー: what the phone saw when it talked to the server – for "it sometimes does not connect" */
export function NetLogRow() {
  useScheme();
  const entries = useNetLog((s) => s.entries);
  const now = Date.now();
  const s = summarize(entries, now);
  const sub = s.total === 0 ? 'まだ記録がありません' : `直近24時間: ${s.ok}回成功・${s.failed}回失敗${s.paused ? `・休止 ${s.paused}回` : ''}${s.failed ? `\n最後の失敗の原因: ${s.timeout + s.network >= s.http + s.badbody ? (s.timeout >= s.network ? '時間切れ' : 'つながらない') : 'サーバーのエラー'}が多い` : ''}`;
  const open = () =>
    Alert.alert('通信の記録（トークンサーバー）', dialogLines(entries, Date.now()).join('\n'), [
      { text: '共有', onPress: () => void Share.share({ message: shareText(entries, Date.now(), APP_VERSION) }).catch(() => undefined) },
      { text: '消す', style: 'destructive', onPress: clearNetLog },
      { text: '閉じる', style: 'cancel' },
    ]);
  return (
    <Pressable testID="netlog-open" onPress={open}>
      <Row title="通信の記録" info="トークンサーバーへの通信の結果（成功・失敗・かかった時間）を、記録します。" sub={sub} last>
        <Text style={{ color: colors.accentText, fontWeight: '700' }}>見る</Text>
      </Row>
    </Pressable>
  );
}
