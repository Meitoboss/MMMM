import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type OtaSnapshot, formatWhen, otaMessage, otaPhase, runningLine, shortError, shortId } from '../src/core/ota';

const base: OtaSnapshot = { enabled: true, isChecking: false, isDownloading: false, isUpdatePending: false };

describe('what the update screen says', () => {
  it('each situation has its own words', () => {
    assert.equal(otaPhase({ ...base, enabled: false }), 'disabled');
    assert.equal(otaPhase(base), 'idle');
    assert.equal(otaPhase({ ...base, isChecking: true }), 'checking');
    assert.equal(otaPhase({ ...base, isDownloading: true }), 'downloading');
    assert.equal(otaPhase({ ...base, isUpdatePending: true }), 'pending');
    assert.equal(otaPhase({ ...base, error: 'HTTP 404' }), 'error');
    assert.equal(otaPhase({ ...base, emergencyReason: 'crash' }), 'emergency');
  });

  it('downloading beats checking beats a waiting update; an emergency beats everything that is on', () => {
    assert.equal(otaPhase({ ...base, isChecking: true, isDownloading: true }), 'downloading');
    assert.equal(otaPhase({ ...base, isChecking: true, isUpdatePending: true }), 'checking');
    assert.equal(otaPhase({ ...base, isUpdatePending: true, error: 'x' }), 'pending');
    assert.equal(otaPhase({ ...base, isDownloading: true, emergencyReason: 'x' }), 'emergency');
    assert.equal(otaPhase({ enabled: false, isChecking: true, isDownloading: true, isUpdatePending: true, emergencyReason: 'x', error: 'y' }), 'disabled');
  });

  it('the messages tell what to do', () => {
    assert.match(otaMessage({ ...base, enabled: false }), /使いません/);
    assert.equal(otaMessage(base), '最新です');
    assert.match(otaMessage({ ...base, isUpdatePending: true }), /再起動すると反映/);
    assert.match(otaMessage({ ...base, error: 'HTTP 404' }), /取得できませんでした（HTTP 404）/);
    assert.match(otaMessage({ ...base, emergencyReason: 'ここで失敗' }), /アプリに入っている版で動いています（ここで失敗）/);
  });
});

describe('which version is running', () => {
  it('the version inside the app, or the delivered one with its time and a short id', () => {
    assert.equal(runningLine({ isEmbedded: true, updateId: 'whatever' }), 'アプリに入っている版');
    const d = new Date(2026, 9, 8, 12, 30);
    assert.equal(runningLine({ isEmbedded: false, createdAt: d, updateId: '123e4567-e89b-12d3-a456-426614174000' }), '配信された版（2026-10-08 12:30） ・ 123e4567');
    assert.equal(runningLine({ isEmbedded: false }), '配信された版');
  });
  it('dates: the phone\'s own time, and nonsense gives nothing', () => {
    assert.equal(formatWhen(new Date(2026, 0, 2, 3, 4)), '2026-01-02 03:04');
    assert.equal(formatWhen(null), '');
    assert.equal(formatWhen('not a date'), '');
    assert.equal(formatWhen(new Date(2026, 9, 8, 12, 30).toISOString()), '2026-10-08 12:30');
  });
  it('short ids and errors', () => {
    assert.equal(shortId('123e4567-e89b'), '123e4567');
    assert.equal(shortId(null), '');
    assert.equal(shortError(new Error('a\n  b\tc')), 'a b c');
    assert.equal(shortError('x'.repeat(500)).length, 160);
    assert.equal(shortError(undefined), '');
  });
});
