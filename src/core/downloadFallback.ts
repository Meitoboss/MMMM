/**
 * Saving a song for offline use on iPhone.
 *
 * expo-file-system downloads in a BACKGROUND session by default: the system's transfer service (nsurlsessiond) downloads for the
 * app, even when it is not on the screen. That service has to recognise the app by its signature, and an app that was re-signed by
 * some signing tools is cut off in the middle of a download (NSURLErrorDomain). The other kind, a FOREGROUND session, runs inside
 * the app and does not depend on that. So: try the usual way first; if the system's network layer cuts the download, do it again in
 * the app's own session, and remember that this is what works on this phone.
 */
export type SessionKind = 'background' | 'foreground';

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : e && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : String(e ?? ''));

/** the number in `Error Domain=NSURLErrorDomain Code=-1005 "…"` */
export function nsErrorCode(e: unknown): number | null {
  const m = /Code=(-?\d+)/.exec(messageOf(e));
  return m ? Number(m[1]) : null;
}

/** an error of the system's network layer (not our own message, not a refusal by the server, not a cancel by the person) */
export function isNativeNetworkError(e: unknown): boolean {
  const t = messageOf(e);
  if (/NSURLErrorDomain|Error Domain=NS/i.test(t)) return nsErrorCode(e) !== -999; // -999 is "cancelled"
  return /Lost connection to the background transfer service|network connection was lost|Network request failed|request timed out|Internet connection appears to be offline/i.test(t);
}

const NS_CODES: Record<number, string> = {
  [-997]: 'システムの通信の係とのつながりが、切れました',
  [-999]: '中止されました',
  [-1001]: '時間切れです（相手が答えません）',
  [-1002]: '住所（URL）が正しくありません',
  [-1003]: '相手のサーバーが、見つかりません',
  [-1004]: '相手のサーバーに、つながりません',
  [-1005]: '通信が、途中で切れました',
  [-1008]: '相手のデータが、使えません',
  [-1009]: 'インターネットに、つながっていません',
  [-1011]: '相手の返事が、正しくありません',
  [-1013]: '認証が必要と言われました',
  [-1014]: '空の返事でした',
  [-1017]: '相手の返事を、読めません',
  [-1020]: 'モバイル通信が、許可されていません',
  [-1022]: '安全でない通信が、許可されていません',
  [-1100]: '相手に、ファイルがありません',
  [-1103]: 'データが、大きすぎます',
  [-1200]: '安全な接続（SSL）に、失敗しました',
  [-1201]: '相手の時計が、ずれています（安全な接続）',
  [-1202]: '相手の証明書が、信頼できません',
  [-1203]: '相手の証明書が、正しくありません',
  [-1204]: '相手の証明書が、まだ有効ではありません',
  [-1205]: '相手が、証明書を拒みました',
  [-1206]: '相手が、証明書を求めています',
};

/** what the list of saves says about a failure: plain words, and the code (the full original text is kept for sharing) */
export function explainDownloadError(raw: unknown): string {
  const t = messageOf(raw).trim();
  if (!t) return 'エラー';
  const code = nsErrorCode(t);
  if (code !== null && /NSURLErrorDomain|Error Domain=NS/i.test(t)) {
    const words = NS_CODES[code] ?? '通信のエラーです';
    const first = /（最初の試み/.test(t) ? '（最初の試みも、同じ原因で失敗しました）' : '';
    return `${words}（コード ${code}）${first}`;
  }
  const oneLine = t.split('\n')[0];
  return oneLine.length > 110 ? `${oneLine.slice(0, 109)}…` : oneLine;
}

export interface FallbackOptions<T> {
  /** how this phone downloaded last time (the way that worked) */
  prefer: SessionKind;
  attempt(kind: SessionKind): Promise<T>;
  isCancelled(): boolean;
  /** called once, when the second way worked where the first did not */
  remember(kind: SessionKind): void;
}

export async function downloadWithFallback<T>(o: FallbackOptions<T>): Promise<T> {
  if (o.prefer === 'foreground') return o.attempt('foreground');
  try {
    return await o.attempt('background');
  } catch (first) {
    if (o.isCancelled() || !isNativeNetworkError(first)) throw first;
    try {
      const result = await o.attempt('foreground');
      o.remember('foreground');
      return result;
    } catch (second) {
      if (o.isCancelled()) throw second;
      throw new Error(`${messageOf(second)}\n（最初の試み: ${messageOf(first).slice(0, 120)}）`);
    }
  }
}
