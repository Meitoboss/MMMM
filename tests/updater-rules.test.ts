import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  APPLY_MODES, DEFAULT_APPLY_MODE, FOREGROUND_GAP_MS, PERIODIC_GAP_MS, SWITCH_DELAY_MS, WAIT_POLL_MS, appliedContent, cleanNote, decide,
  emergencyContent, isApplyMode, noteFromManifest, promptContent, shouldCheck, shouldShowApplied,
} from '../src/core/updater';

const base = { enabled: true, busy: false, pending: false, now: 10_000_000, lastCheckAt: null as number | null };

describe('when to look for an update', () => {
  it('never when updates are off, or a look is already going on', () => {
    for (const reason of ['start', 'foreground', 'tick', 'manual'] as const) {
      assert.equal(shouldCheck({ ...base, enabled: false, reason }), false);
      assert.equal(shouldCheck({ ...base, busy: true, reason }), false);
    }
  });
  it('at the start: unless it just looked (30 s)', () => {
    assert.equal(shouldCheck({ ...base, reason: 'start' }), true);
    assert.equal(shouldCheck({ ...base, reason: 'start', lastCheckAt: base.now - 10_000 }), false);
    assert.equal(shouldCheck({ ...base, reason: 'start', lastCheckAt: base.now - 31_000 }), true);
  });
  it('coming back to the app: at most every ten minutes', () => {
    assert.equal(shouldCheck({ ...base, reason: 'foreground', lastCheckAt: base.now - FOREGROUND_GAP_MS + 1 }), false);
    assert.equal(shouldCheck({ ...base, reason: 'foreground', lastCheckAt: base.now - FOREGROUND_GAP_MS }), true);
    assert.equal(shouldCheck({ ...base, reason: 'foreground' }), true);
  });
  it('while the app stays open: about once an hour', () => {
    assert.equal(shouldCheck({ ...base, reason: 'tick', lastCheckAt: base.now - PERIODIC_GAP_MS + 1 }), false);
    assert.equal(shouldCheck({ ...base, reason: 'tick', lastCheckAt: base.now - PERIODIC_GAP_MS }), true);
  });
  it('when a download is waiting nothing is looked for – except by hand', () => {
    for (const reason of ['start', 'foreground', 'tick'] as const) assert.equal(shouldCheck({ ...base, pending: true, reason }), false);
    assert.equal(shouldCheck({ ...base, pending: true, reason: 'manual' }), true);
  });
  it('by hand: always (when updates are on and nothing is running)', () => {
    assert.equal(shouldCheck({ ...base, reason: 'manual', lastCheckAt: base.now - 1 }), true);
  });
});

describe('what to do with a downloaded version', () => {
  const idle = { playing: false, working: false };
  it('ask (the default): asks once; not in the middle of a long job', () => {
    assert.equal(DEFAULT_APPLY_MODE, 'ask');
    assert.equal(decide('ask', idle, false), 'prompt');
    assert.equal(decide('ask', { playing: true, working: false }, false), 'prompt', 'while music plays the pop-up says it will stop');
    assert.equal(decide('ask', { playing: false, working: true }, false), 'wait');
    assert.equal(decide('ask', idle, true), 'leave', 'already asked about this version');
  });
  it('auto: switches only when nothing is playing and nothing is running', () => {
    assert.equal(decide('auto', idle, false), 'switch');
    assert.equal(decide('auto', { playing: true, working: false }, false), 'wait');
    assert.equal(decide('auto', { playing: false, working: true }, false), 'wait');
    assert.equal(decide('auto', { playing: true, working: true }, true), 'wait');
  });
  it('manual: never by itself', () => {
    for (const sit of [idle, { playing: true, working: true }]) assert.equal(decide('manual', sit, false), 'leave');
  });
  it('a version that did not start last time is never forced again, whatever the mode', () => {
    for (const mode of ['ask', 'auto', 'manual'] as const) assert.equal(decide(mode, idle, false, true), 'leave');
  });
  it('the modes are described, and checked', () => {
    assert.deepEqual(APPLY_MODES.map((m) => m.value), ['ask', 'auto', 'manual']);
    for (const m of APPLY_MODES) assert.ok(m.label && m.hint);
    assert.ok(isApplyMode('auto') && !isApplyMode('always') && !isApplyMode(null) && !isApplyMode(1));
  });
  it('the pauses are what the screens rely on', () => {
    assert.ok(WAIT_POLL_MS >= 1000 && WAIT_POLL_MS <= 10_000);
    assert.ok(SWITCH_DELAY_MS >= 500 && SWITCH_DELAY_MS <= 2000);
  });
});

describe('the release note', () => {
  it('is cleaned: control characters, long blank runs, length; nothing → null', () => {
    assert.equal(cleanNote('  検索が速くなりました  '), '検索が速くなりました');
    assert.equal(cleanNote('a\u0000b\u0007c'), 'abc');
    assert.equal(cleanNote('一行目\r\n\r\n\r\n\r\n二行目'), '一行目\n\n二行目');
    assert.equal(cleanNote('x'.repeat(1000))!.length, 400);
    assert.ok(cleanNote('あ'.repeat(1000))!.endsWith('…'));
    assert.equal(Array.from(cleanNote('😀'.repeat(500))!).length, 400, 'letters, not UTF-16 units');
    for (const v of ['', '   ', '\n\n', null, undefined, 5, {}, ['x']]) assert.equal(cleanNote(v), null);
  });
  it('is read from extra.releaseNote of a manifest, and nowhere else', () => {
    assert.equal(noteFromManifest({ id: 'u1', extra: { releaseNote: '新機能あり', expoClient: {} } }), '新機能あり');
    for (const m of [null, undefined, {}, { extra: {} }, { extra: { releaseNote: 5 } }, 'text', { note: 'x' }]) assert.equal(noteFromManifest(m), null);
  });
});

describe('the pop-ups', () => {
  it('"new version": the note, and what happens when it is applied (music stops, or not)', () => {
    const idle = promptContent('検索が速くなりました', { playing: false, working: false });
    assert.equal(idle.title, '新しい版を取得しました');
    assert.match(idle.message, /検索が速くなりました/);
    assert.match(idle.message, /アプリを閉じずに/);
    assert.doesNotMatch(idle.message, /一度止まります/);
    const playing = promptContent(null, { playing: true, working: false });
    assert.match(playing.message, /アプリの中身が、新しくなりました/);
    assert.match(playing.message, /再生中の音楽が一度止まります/);
  });
  it('"updated": the note, or a plain sentence', () => {
    assert.deepEqual(appliedContent('追加: BPM'), { title: '更新しました', message: '追加: BPM' });
    assert.match(appliedContent(null).message, /新しい版/);
  });
  it('"could not start": says what happened, why, and that it will not be forced again', () => {
    const e = emergencyContent('JS error');
    assert.match(e.message, /アプリに入っている版/);
    assert.match(e.message, /JS error/);
    assert.match(e.message, /自動では切り替えません/);
    assert.doesNotMatch(emergencyContent(null).message, /（/);
  });
  it('"updated" is shown once per update, never for the version inside the app', () => {
    assert.equal(shouldShowApplied(null, 'u1', false), true);
    assert.equal(shouldShowApplied('u0', 'u1', false), true);
    assert.equal(shouldShowApplied('u1', 'u1', false), false);
    assert.equal(shouldShowApplied(null, 'u1', true), false);
    assert.equal(shouldShowApplied(null, null, false), false);
  });
});
