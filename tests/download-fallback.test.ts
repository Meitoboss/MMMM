import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type SessionKind, downloadWithFallback, explainDownloadError, isNativeNetworkError, nsErrorCode } from '../src/core/downloadFallback';

const ns = (code: number, text = 'The network connection was lost.') => new Error(`Error Domain=NSURLErrorDomain Code=${code} "${text}" UserInfo={NSLocalizedDescription=${text}}`);

describe('which errors are the system\'s network layer', () => {
  it('reads the code from the text iOS gives', () => {
    assert.equal(nsErrorCode(ns(-1005)), -1005);
    assert.equal(nsErrorCode(ns(-997)), -997);
    assert.equal(nsErrorCode(new Error('HTTP 403')), null);
    assert.equal(nsErrorCode('Error Domain=NSURLErrorDomain Code=-1001 "x"'), -1001);
    assert.equal(nsErrorCode(undefined), null);
  });

  it('system network errors are recognised – cut connection, time-out, offline, lost transfer service, plain "Network request failed"', () => {
    for (const c of [-997, -1001, -1004, -1005, -1009, -1011, -1200]) assert.ok(isNativeNetworkError(ns(c)), String(c));
    assert.ok(isNativeNetworkError(new Error('Network request failed')));
    assert.ok(isNativeNetworkError(new Error('Lost connection to the background transfer service')));
    assert.ok(isNativeNetworkError('The request timed out.'));
  });

  it('a cancel by the person, our own messages and a refusal by the server are not', () => {
    assert.ok(!isNativeNetworkError(ns(-999, 'cancelled')));
    assert.ok(!isNativeNetworkError(new Error('cancelled')));
    assert.ok(!isNativeNetworkError(new Error('保存できませんでした（HTTP 403）')));
    assert.ok(!isNativeNetworkError(new Error('ダウンロードしたデータが小さすぎます')));
    assert.ok(!isNativeNetworkError(new Error('曲の情報が見つかりません')));
    assert.ok(!isNativeNetworkError(undefined));
    assert.ok(!isNativeNetworkError(null));
  });
});

describe('the words in the list of saves', () => {
  it('a system error: plain words and the code – the part that used to be cut off', () => {
    assert.equal(explainDownloadError(ns(-1005)), '通信が、途中で切れました（コード -1005）');
    assert.equal(explainDownloadError(ns(-1001)), '時間切れです（相手が答えません）（コード -1001）');
    assert.equal(explainDownloadError(ns(-997)), 'システムの通信の係とのつながりが、切れました（コード -997）');
    assert.equal(explainDownloadError(ns(-1009)), 'インターネットに、つながっていません（コード -1009）');
    assert.equal(explainDownloadError(ns(-12345)), '通信のエラーです（コード -12345）', 'a code that is not in the table is still shown');
  });

  it('our own messages stay as they are; long or many-line text is cut sensibly; nothing gives a blank', () => {
    assert.equal(explainDownloadError(new Error('保存できませんでした（HTTP 403）')), '保存できませんでした（HTTP 403）');
    assert.equal(explainDownloadError('a\nb'), 'a');
    const long = explainDownloadError('x'.repeat(300));
    assert.equal(long.length, 110);
    assert.ok(long.endsWith('…'));
    for (const v of [undefined, null, '', '   ']) assert.equal(explainDownloadError(v), 'エラー');
  });

  it('says when the first way had failed in the same way', () => {
    const e = new Error(`${ns(-1005).message}\n（最初の試み: ${ns(-997).message}）`);
    assert.match(explainDownloadError(e), /^通信が、途中で切れました（コード -1005）（最初の試みも、同じ原因で失敗しました）$/);
  });
});

describe('trying the usual way first, then the app\'s own session', () => {
  const run = (script: Record<SessionKind, (() => Promise<string>)[]>, opts: { prefer?: SessionKind; cancelled?: () => boolean } = {}) => {
    const tried: SessionKind[] = [];
    const remembered: SessionKind[] = [];
    const attempt = (k: SessionKind) => {
      tried.push(k);
      const step = script[k].shift();
      if (!step) throw new Error(`unexpected attempt: ${k}`);
      return step();
    };
    const promise = downloadWithFallback({ prefer: opts.prefer ?? 'background', attempt, isCancelled: opts.cancelled ?? (() => false), remember: (k) => void remembered.push(k) });
    return { promise, tried, remembered };
  };
  const ok = (v: string) => async () => v;
  const fail = (e: Error) => async () => { throw e; };

  it('the usual way works: nothing else is tried, nothing is remembered', async () => {
    const r = run({ background: [ok('done')], foreground: [] });
    assert.equal(await r.promise, 'done');
    assert.deepEqual(r.tried, ['background']);
    assert.deepEqual(r.remembered, []);
  });

  it('cut by the network layer: done again in the app\'s own session – and that is remembered', async () => {
    const r = run({ background: [fail(ns(-1005))], foreground: [ok('done')] });
    assert.equal(await r.promise, 'done');
    assert.deepEqual(r.tried, ['background', 'foreground']);
    assert.deepEqual(r.remembered, ['foreground']);
  });

  it('what worked is used first from then on (no wasted half download)', async () => {
    const r = run({ background: [], foreground: [ok('done')] }, { prefer: 'foreground' });
    assert.equal(await r.promise, 'done');
    assert.deepEqual(r.tried, ['foreground']);
    assert.deepEqual(r.remembered, []);
  });

  it('a refusal by the server (HTTP 403) is not a network problem: no second try', async () => {
    const r = run({ background: [fail(new Error('保存できませんでした（HTTP 403）'))], foreground: [] });
    await assert.rejects(r.promise, /HTTP 403/);
    assert.deepEqual(r.tried, ['background']);
  });

  it('cancelled by the person: no second try, and the cancel is what is reported', async () => {
    const r = run({ background: [fail(ns(-999, 'cancelled'))], foreground: [] }, { cancelled: () => true });
    await assert.rejects(r.promise, /-999/);
    assert.deepEqual(r.tried, ['background']);
    const r2 = run({ background: [fail(ns(-1005))], foreground: [fail(new Error('cancelled'))] }, { cancelled: (() => { let n = 0; return () => ++n > 1; })() });
    await assert.rejects(r2.promise, /^Error: cancelled$/);
  });

  it('both fail: one error with both reasons, and nothing is remembered', async () => {
    const r = run({ background: [fail(ns(-997))], foreground: [fail(ns(-1001, 'The request timed out.'))] });
    await assert.rejects(r.promise, (e: Error) => {
      assert.match(e.message, /Code=-1001/);
      assert.match(e.message, /（最初の試み: .*Code=-997/);
      assert.equal(explainDownloadError(e), '時間切れです（相手が答えません）（コード -1001）（最初の試みも、同じ原因で失敗しました）');
      return true;
    });
    assert.deepEqual(r.remembered, []);
  });

  it('the second way is tried only once (no loop)', async () => {
    const r = run({ background: [fail(ns(-1005))], foreground: [fail(ns(-1005))] });
    await assert.rejects(r.promise);
    assert.deepEqual(r.tried, ['background', 'foreground']);
  });
});
