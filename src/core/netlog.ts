/**
 * A record of how the token server answered – one entry per request, kept on the phone. When "it sometimes does not connect",
 * this is what the PHONE saw: when, how long it waited, and how it failed. Pure logic (no storage here), so it can be tested.
 */
export type NetOutcome = 'ok' | 'timeout' | 'network' | 'http' | 'key' | 'badbody' | 'paused';
export type NetWhat = 'mint' | 'ping';

export interface NetEntry {
  /** when the request ended (ms since 1970) */
  at: number;
  what: NetWhat;
  outcome: NetOutcome;
  /** how long it took, in ms */
  ms: number;
  /** the HTTP status, when there was an answer */
  status?: number;
}

export const NET_LOG_MAX = 120;
/** an answer that took this long is "slow": the app gives up at 8 s */
export const SLOW_MS = 3000;
const DAY_MS = 24 * 3600_000;

export const OUTCOME_LABEL: Record<NetOutcome, string> = {
  ok: '成功',
  timeout: '時間切れ（8秒たっても答えなし）',
  network: 'つながらない',
  http: 'サーバーのエラー',
  key: 'キーが違う',
  badbody: '返事が変',
  paused: '休止中（問い合わせなかった）',
};

const OUTCOMES = new Set<string>(Object.keys(OUTCOME_LABEL));

export const isFailure = (e: Pick<NetEntry, 'outcome'>): boolean => e.outcome === 'timeout' || e.outcome === 'network' || e.outcome === 'http' || e.outcome === 'badbody';

/** a new list with `e` added at the end; only the newest `max` are kept */
export function addEntry(list: NetEntry[], e: NetEntry, max = NET_LOG_MAX): NetEntry[] {
  const next = [...list, e];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** what comes back from storage is not trusted: every field is checked, what is wrong is dropped */
export function sanitizeEntries(raw: unknown): NetEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: NetEntry[] = [];
  for (const r of raw) {
    const e = r as Partial<NetEntry> | null;
    if (!e || typeof e !== 'object') continue;
    if (typeof e.at !== 'number' || !Number.isFinite(e.at) || e.at <= 0) continue;
    if ((e.what !== 'mint' && e.what !== 'ping') || typeof e.outcome !== 'string' || !OUTCOMES.has(e.outcome)) continue;
    if (typeof e.ms !== 'number' || !Number.isFinite(e.ms) || e.ms < 0 || e.ms > 600_000) continue;
    const status = typeof e.status === 'number' && Number.isInteger(e.status) && e.status >= 100 && e.status <= 599 ? e.status : undefined;
    out.push({ at: Math.trunc(e.at), what: e.what, outcome: e.outcome as NetOutcome, ms: Math.round(e.ms), ...(status ? { status } : {}) });
  }
  return out.slice(-NET_LOG_MAX);
}

export interface NetSummary {
  total: number;
  ok: number;
  failed: number;
  timeout: number;
  network: number;
  http: number;
  badbody: number;
  key: number;
  paused: number;
  /** answered, but took SLOW_MS or more */
  slow: number;
  medianMs: number | null;
  p95Ms: number | null;
  /** the most failures in a row (a pause or a wrong key neither breaks nor extends a run) */
  worstStreak: number;
  lastFailureAt: number | null;
}

export function summarize(entries: NetEntry[], now: number, windowMs = DAY_MS): NetSummary {
  const w = entries.filter((e) => now - e.at <= windowMs);
  const count = (o: NetOutcome) => w.filter((e) => e.outcome === o).length;
  const times = w.filter((e) => e.outcome === 'ok').map((e) => e.ms).sort((a, b) => a - b);
  let streak = 0;
  let worst = 0;
  for (const e of [...w].sort((a, b) => a.at - b.at)) {
    if (isFailure(e)) worst = Math.max(worst, ++streak);
    else if (e.outcome === 'ok') streak = 0;
  }
  const failures = w.filter(isFailure);
  return {
    total: w.length,
    ok: times.length,
    failed: failures.length,
    timeout: count('timeout'),
    network: count('network'),
    http: count('http'),
    badbody: count('badbody'),
    key: count('key'),
    paused: count('paused'),
    slow: times.filter((ms) => ms >= SLOW_MS).length,
    medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
    p95Ms: times.length ? times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] : null,
    worstStreak: worst,
    lastFailureAt: failures.length ? Math.max(...failures.map((e) => e.at)) : null,
  };
}

/** a plain-words reading of the numbers */
export function diagnose(s: NetSummary): string {
  if (s.total === 0) return 'まだ記録がありません。曲を再生したり、接続テストをすると、ここに記録されます。';
  if (s.failed === 0 && s.key > 0) return 'キーが違う、という返事が来ています。設定の「キー」を確認してください。';
  if (s.failed === 0) return s.slow > 0 ? `失敗はありません。ただし、${s.slow}回は、${SLOW_MS / 1000}秒以上かかりました（サーバーが少し重いかもしれません）。` : '失敗は、記録されていません。';
  const lines: string[] = [];
  if (s.timeout + s.network >= s.http + s.badbody) {
    lines.push(s.timeout >= s.network ? '「時間切れ」が多い: サーバーが固まっていたか、回線が不安定でした。' : '「つながらない」が多い: サーバーまでの回線が途切れたか、サーバーが止まっていました。');
  } else {
    lines.push('「サーバーのエラー」が多い: トークンサーバー自体の不調（メモリ不足など）の疑いがあります。');
  }
  if (s.ok > 0) lines.push('成功することもあるので、続いて失敗する不調ではなく、一時的なものです。');
  if (s.slow > 0) lines.push(`成功のうち ${s.slow}回は、${SLOW_MS / 1000}秒以上かかりました。`);
  if (s.paused > 0) lines.push(`失敗が続いたため、${s.paused}回は、休止して、問い合わせませんでした（その間は、端末だけの方法で再生します）。`);
  return lines.join('\n');
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** 10-09 14:03:27 (the phone's own time) */
export function stamp(at: number): string {
  const d = new Date(at);
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
/** 150 ms → 0.2秒 (rounded on whole tenths: toFixed would show 0.1 because of how 0.15 is stored) */
const secs = (ms: number): string => `${(Math.round(ms / 100) / 10).toFixed(1)}秒`;

/** what the dialog shows: the numbers, a reading, and the latest failures */
export function dialogLines(entries: NetEntry[], now: number, recent = 8): string[] {
  const s = summarize(entries, now);
  if (s.total === 0) return [diagnose(s)];
  const head = [`直近24時間: ${s.total}回（成功 ${s.ok} / 失敗 ${s.failed}${s.paused ? ` / 休止中 ${s.paused}` : ''}${s.key ? ` / キー違い ${s.key}` : ''}）`];
  if (s.medianMs !== null) head.push(`成功の速さ: ふつう ${secs(s.medianMs)} / 遅いとき ${secs(s.p95Ms ?? s.medianMs)}`);
  if (s.failed) head.push(`いちばん長い連続失敗: ${s.worstStreak}回　最後の失敗: ${stamp(s.lastFailureAt ?? now)}`);
  const fails = recent > 0 ? entries.filter(isFailure).slice(-recent).reverse() : []; // slice(-0) would be everything
  return [...head, '', diagnose(s), ...(fails.length ? ['', '最近の失敗:', ...fails.map((e) => `${stamp(e.at)}  ${OUTCOME_LABEL[e.outcome]}  ${secs(e.ms)}${e.status ? `  HTTP ${e.status}` : ''}`)] : [])];
}

/** everything, one line each, to paste into a message */
export function shareText(entries: NetEntry[], now: number, appVersion: string): string {
  const s = summarize(entries, now);
  const head = [`Music space 通信の記録 (app ${appVersion}, ${stamp(now)})`, ...dialogLines(entries, now, 0).filter((l) => l !== ''), '', '--- 1行1回 (新しい順) ---'];
  const rows = [...entries].reverse().map((e) => `${stamp(e.at)} ${e.what} ${e.outcome} ${(e.ms / 1000).toFixed(2)}s${e.status ? ` http=${e.status}` : ''}`);
  return [...head, ...(s.total === 0 && rows.length === 0 ? [] : rows)].join('\n');
}
