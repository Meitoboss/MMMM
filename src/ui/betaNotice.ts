import Storage from 'expo-sqlite/kv-store';
import { Alert } from 'react-native';

const KEY = 'dj.betaNotice.v1';

/** Shown the first time the DJ tab is opened – once, never again. Returns true when the notice was shown. */
export function showDjBetaOnce(): boolean {
  try {
    if (Storage.getItemSync(KEY) === '1') return false;
    Storage.setItemSync(KEY, '1'); // marked as seen when it is shown, so it can never come back
  } catch {
    return false; // storage trouble: better no notice than one on every visit
  }
  Alert.alert(
    'DJ機能は、ベータ版です',
    'ホットキュー、区間ループ、スタート／エンド位置、フェードつなぎは、まだ試験中の機能です。\n\n動きが不安定なことがあり、今後、使い方や見た目が変わる可能性があります。うまく動かないときは、お知らせください。',
    [{ text: 'OK' }],
  );
  return true;
}
