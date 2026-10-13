import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { NET_LOG_MAX, type NetEntry, OUTCOME_LABEL, SLOW_MS, addEntry, diagnose, dialogLines, isFailure, sanitizeEntries, shareText, stamp, summarize } from '../src/core/netlog';
import { BREAKER_FAILURES, configureRemotePot, mintRemote, pingRemote, setRemoteObserver } from '../src/core/pot/remote';

const T0 = new Date(2026, 9, 9, 12, 0, 0).getTime();
const e = (min: number, outcome: NetEntry['outcome'], ms = 800, over: Partial<NetEntry> = {}): NetEntry => ({ at: T0 + min * 60_000, what: 'mint', outcome, ms, ...over });

describe('the record of how the token server answered', () => {
  it('keeps the newest entries only', () => {
    let list: NetEntry[] = [];
    for (let i = 0; i < NET_LOG_MAX + 30; i++) list = addEntry(list, e(i, 'ok'));
    assert.equal(list.length, NET_LOG_MAX);
    assert.equal(list[0].at, T0 + 30 * 60_000);
    assert.equal(list.at(-1)!.at, T0 + (NET_LOG_MAX + 29) * 60_000);
    const before = [e(0, 'ok')];
    addEntry(before, e(1, 'ok'));
    assert.equal(before.length, 1, 'the old list is not changed');
  });

  it('what comes back from storage is checked: wrong entries are dropped, the rest kept in order', () => {
    const raw = [e(1, 'ok'), null, 5, 'x', { at: 'now', what: 'mint', outcome: 'ok', ms: 1 }, { ...e(2, 'ok'), what: 'other' }, { ...e(3, 'ok'), outcome: 'weird' }, { ...e(4, 'ok'), ms: -1 }, { ...e(5, 'ok'), ms: 1e9 }, { ...e(6, 'ok'), at: 0 }, { ...e(7, 'http'), status: 502 }, { ...e(8, 'http'), status: 'bad' }, { ...e(9, 'ok'), at: Number.NaN }];
    const got = sanitizeEntries(raw);
    assert.deepEqual(got.map((x) => x.at), [T0 + 60_000, T0 + 7 * 60_000, T0 + 8 * 60_000]);
    assert.equal(got[1].status, 502);
    assert.ok(!('status' in got[2]));
    assert.deepEqual(sanitizeEntries(null), []);
    assert.deepEqual(sanitizeEntries('x'), []);
    assert.equal(sanitizeEntries(Array.from({ length: 500 }, (_, i) => e(i, 'ok'))).length, NET_LOG_MAX);
  });

  it('every kind of outcome has words; only real failures count as failures', () => {
    for (const o of Object.keys(OUTCOME_LABEL) as NetEntry['outcome'][]) assert.ok(OUTCOME_LABEL[o].length > 1);
    const failing = (['ok', 'timeout', 'network', 'http', 'key', 'badbody', 'paused'] as const).filter((o) => isFailure({ outcome: o }));
    assert.deepEqual(failing, ['timeout', 'network', 'http', 'badbody']);
  });

  it('the numbers: counts per kind, how fast the good answers were, the longest run of failures, the last failure', () => {
    const list = [e(0, 'ok', 500), e(1, 'ok', 700), e(2, 'timeout', 8000), e(3, 'timeout', 8000), e(4, 'paused', 0), e(5, 'network', 20), e(6, 'ok', 900), e(7, 'ok', 4200), e(8, 'http', 100, { status: 502 }), e(9, 'key', 50, { status: 401 }), e(10, 'ok', 600)];
    const s = summarize(list, T0 + 11 * 60_000);
    assert.deepEqual({ total: s.total, ok: s.ok, failed: s.failed, timeout: s.timeout, network: s.network, http: s.http, key: s.key, paused: s.paused, slow: s.slow }, { total: 11, ok: 5, failed: 4, timeout: 2, network: 1, http: 1, key: 1, paused: 1, slow: 1 });
    assert.equal(s.medianMs, 700);
    assert.equal(s.p95Ms, 4200);
    assert.equal(s.worstStreak, 3, 'timeout, timeout, (paused changes nothing), network');
    assert.equal(s.lastFailureAt, T0 + 8 * 60_000);
  });

  it('only the last 24 hours count', () => {
    const list = [e(-30 * 60, 'timeout'), e(-25 * 60, 'ok'), e(-23 * 60, 'ok'), e(-10, 'ok'), e(0, 'timeout')];
    const s = summarize(list, T0 + 60_000);
    assert.deepEqual({ total: s.total, ok: s.ok, failed: s.failed }, { total: 3, ok: 2, failed: 1 });
    assert.equal(summarize([], T0).total, 0);
    assert.equal(summarize([], T0).medianMs, null);
  });

  it('a reading in words for each situation', () => {
    const now = T0 + 3600_000;
    assert.match(diagnose(summarize([], now)), /まだ記録がありません/);
    assert.match(diagnose(summarize([e(1, 'ok'), e(2, 'ok')], now)), /失敗は、記録されていません/);
    assert.match(diagnose(summarize([e(1, 'ok'), e(2, 'ok', SLOW_MS + 500)], now)), /1回は、3秒以上かかりました/);
    assert.match(diagnose(summarize([e(1, 'key', 10, { status: 401 })], now)), /「キー」を確認/);
    const timeouts = diagnose(summarize([e(1, 'timeout', 8000), e(2, 'timeout', 8000), e(3, 'ok')], now));
    assert.match(timeouts, /「時間切れ」が多い/);
    assert.match(timeouts, /一時的/);
    assert.match(diagnose(summarize([e(1, 'network', 30), e(2, 'network', 30), e(3, 'timeout', 8000)], now)), /「つながらない」が多い/);
    assert.match(diagnose(summarize([e(1, 'http', 100, { status: 500 }), e(2, 'http', 100, { status: 502 }), e(3, 'network', 30)], now)), /サーバーのエラー.*メモリ不足/);
    assert.match(diagnose(summarize([e(1, 'timeout', 8000), e(2, 'timeout', 8000), e(3, 'paused', 0)], now)), /1回は、休止して/);
  });

  it('the dialog: numbers, reading, and the latest failures (newest first, with time, kind, seconds, HTTP status)', () => {
    const list = [e(0, 'ok', 600), e(1, 'timeout', 8012), e(2, 'http', 150, { status: 503 }), e(3, 'ok', 700)];
    const lines = dialogLines(list, T0 + 5 * 60_000);
    assert.equal(lines[0], '直近24時間: 4回（成功 2 / 失敗 2）');
    assert.match(lines[1], /成功の速さ: ふつう 0\.7秒/);
    assert.match(lines[2], /いちばん長い連続失敗: 2回/);
    const text = lines.join('\n');
    assert.ok(text.indexOf('サーバーのエラー') < text.indexOf('時間切れ（8秒たっても答えなし）  8.0秒'), 'newest failure first');
    assert.match(text, /10-09 12:02:00  サーバーのエラー  0\.2秒  HTTP 503/);
    assert.deepEqual(dialogLines([], T0), ['まだ記録がありません。曲を再生したり、接続テストをすると、ここに記録されます。']);
  });

  it('the shared text has everything on one line each, newest first, and the app version', () => {
    const list = [e(0, 'ok', 612), e(1, 'timeout', 8004), e(2, 'http', 90, { status: 502 })];
    const t = shareText(list, T0 + 3 * 60_000, '1.0.2');
    assert.match(t, /^Music space 通信の記録 \(app 1\.0\.2, 10-09 12:03:00\)/);
    const rows = t.split('\n').slice(t.split('\n').indexOf('--- 1行1回 (新しい順) ---') + 1);
    assert.ok(!t.split('\n').slice(0, t.split('\n').indexOf('--- 1行1回 (新しい順) ---')).some((l) => /^10-09 /.test(l)), 'the head has no repeated list of failures');
    assert.deepEqual(rows, ['10-09 12:02:00 mint http 0.09s http=502', '10-09 12:01:00 mint timeout 8.00s', '10-09 12:00:00 mint ok 0.61s']);
    assert.equal(stamp(new Date(2026, 0, 2, 3, 4, 5).getTime()), '01-02 03:04:05');
  });
});

describe('the token server client reports every request', () => {
  const realFetch = globalThis.fetch;
  const seen: { what: string; outcome: string; ms: number; status?: number }[] = [];
  const setup = (url = 'https://s.test') => {
    seen.length = 0;
    configureRemotePot({ url, key: 'k' });
    setRemoteObserver((x) => void seen.push({ what: x.what, outcome: x.outcome, ms: x.ms, status: x.status }));
  };
  afterEach(() => {
    globalThis.fetch = realFetch;
    setRemoteObserver(undefined);
    configureRemotePot(null);
  });
  const reply = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });

  it('a good answer is "ok" with the time it took; the same token again comes from the cache and is no request', async () => {
    setup();
    globalThis.fetch = (async () => { await new Promise((r) => setTimeout(r, 25)); return new Response(JSON.stringify({ poToken: 'T', expiresAt: new Date(Date.now() + 3600_000).toISOString() })); }) as typeof fetch;
    assert.equal(await mintRemote('video1'), 'T');
    assert.equal(await mintRemote('video1'), 'T');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].outcome, 'ok');
    assert.equal(seen[0].what, 'mint');
    assert.ok(seen[0].ms >= 20 && seen[0].ms < 1000, `${seen[0].ms}`);
    assert.equal(seen[0].status, 200);
  });

  it('no answer within the time is "timeout" (and it took about that long); a refused connection is "network"', async () => {
    setup();
    globalThis.fetch = ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as typeof fetch;
    await assert.rejects(() => mintRemote('a', 60), /did not answer within/);
    globalThis.fetch = (async () => { throw new TypeError('Network request failed'); }) as typeof fetch;
    await assert.rejects(() => mintRemote('b', 60), /Network request failed/);
    assert.deepEqual(seen.map((x) => x.outcome), ['timeout', 'network']);
    assert.ok(seen[0].ms >= 50, `the timeout lasted ${seen[0].ms} ms`);
  });

  it('a server error is "http" with its status; a wrong key is "key"; an answer without a token is "badbody"', async () => {
    setup();
    for (const [status, body, want] of [[502, {}, 'http'], [401, {}, 'key'], [200, { error: 'boom' }, 'badbody']] as const) {
      configureRemotePot({ url: 'https://s.test', key: 'k' });
      seen.length = 0;
      globalThis.fetch = reply(status, body) as typeof fetch;
      await assert.rejects(() => mintRemote(`x${status}`, 200));
      assert.deepEqual(seen.map((x) => [x.outcome, x.status]), [[want, status]], String(status));
    }
  });

  it('after repeated failures the client stops asking, and says so in the record ("paused": no request was made)', async () => {
    setup();
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new TypeError('down'); }) as typeof fetch;
    for (let i = 0; i < BREAKER_FAILURES; i++) await assert.rejects(() => mintRemote(`v${i}`, 50));
    await assert.rejects(() => mintRemote('v-next', 50), /paused/);
    assert.equal(calls, BREAKER_FAILURES);
    assert.deepEqual(seen.map((x) => x.outcome), ['network', 'network', 'paused']);
    assert.equal(seen[2].ms, 0);
  });

  it('the connection test (ping) is recorded too, as "ping"', async () => {
    setup();
    globalThis.fetch = reply(200, {}) as typeof fetch;
    await pingRemote(200);
    globalThis.fetch = reply(500) as typeof fetch;
    await assert.rejects(() => pingRemote(200));
    globalThis.fetch = (async () => { throw new TypeError('x'); }) as typeof fetch;
    await assert.rejects(() => pingRemote(200));
    globalThis.fetch = reply(401) as typeof fetch;
    await assert.rejects(() => pingRemote(200));
    assert.deepEqual(seen.map((x) => `${x.what}:${x.outcome}`), ['ping:ok', 'ping:http', 'ping:network', 'ping:key']);
  });

  it('a record that breaks must never break playback; with no observer nothing happens', async () => {
    setup();
    setRemoteObserver(() => { throw new Error('the record is broken'); });
    globalThis.fetch = (async () => new Response(JSON.stringify({ poToken: 'T' }))) as typeof fetch;
    assert.equal(await mintRemote('safe'), 'T');
    setRemoteObserver(undefined);
    assert.equal(await mintRemote('safe2'), 'T');
  });
});
