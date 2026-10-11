import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { APP_VERSION } from '../src/appVersion';
import { AURORA_STRENGTH, BEAT_PATTERN, DRIFT, FADE_HORIZONTAL, FADE_VERTICAL, LAYERS, LIGHT_STRENGTH, PLAY_SPEEDUP, auroraMotion, layerOpacity } from '../src/core/auroraMotion';
import { startsSwipeDown, swipeOutcome } from '../src/core/swipe';

describe('aurora motion', () => {
  it('paused: calm – the slow drift of the original design, and no beat', () => {
    const m = auroraMotion({ playing: false });
    assert.deepEqual(m.driftMs, [38000, 30000, 22000]);
    assert.equal(m.beat, null);
  });

  it('playing: faster drift and a beat', () => {
    const calm = auroraMotion({ playing: false });
    const m = auroraMotion({ playing: true });
    m.driftMs.forEach((ms, i) => assert.ok(ms < calm.driftMs[i] / 3, `layer ${i} is more than 3x faster`));
    assert.deepEqual(m.driftMs, LAYERS.map((l) => Math.round(l.calmMs / PLAY_SPEEDUP)));
    assert.ok(m.beat);
    assert.equal(m.beat.periodMs, 500, '120 beats per minute at normal speed');
    assert.equal(m.beat.attackMs + m.beat.releaseMs, m.beat.periodMs, 'a beat is exactly one period long');
    assert.ok(m.beat.attackMs < m.beat.releaseMs, 'a quick hit, a slower fall');
    assert.deepEqual(m.beat.pattern, BEAT_PATTERN);
  });

  it('the beat follows the playback speed (within limits)', () => {
    assert.equal(auroraMotion({ playing: true, rate: 2 }).beat?.periodMs, 250);
    assert.equal(auroraMotion({ playing: true, rate: 0.5 }).beat?.periodMs, 1000);
    assert.equal(auroraMotion({ playing: true, rate: 10 }).beat?.periodMs, 250, 'capped');
    assert.equal(auroraMotion({ playing: true, rate: 0.01 }).beat?.periodMs, 1000, 'capped');
    assert.equal(auroraMotion({ playing: true, rate: Number.NaN }).beat?.periodMs, 500);
    const fast = auroraMotion({ playing: true, rate: 2 }).beat!;
    assert.ok(fast.attackMs >= 40 && fast.attackMs <= 140);
  });

  it('"reduce motion" in the phone settings: no beat even while playing', () => {
    assert.equal(auroraMotion({ playing: true, reduceMotion: true }).beat, null);
  });

  it('a beat makes the ribbons brighter, never beyond 100 %', () => {
    for (const l of LAYERS) {
      const rest = layerOpacity(l, 0);
      const peak = layerOpacity(l, 1);
      assert.ok(peak > rest, `${l.key} brightens`);
      assert.ok(peak <= 1 && rest > 0.3, `${l.key}: ${rest.toFixed(2)} → ${peak.toFixed(2)}`);
      assert.equal(layerOpacity(l, 5), peak, 'a beat value above 1 is cut');
      assert.equal(layerOpacity(l, -1), rest);
    }
    assert.equal(AURORA_STRENGTH, 1);
  });

  it('on a light background the colours are taken down; the beat still brightens them', () => {
    for (const l of LAYERS) {
      assert.ok(layerOpacity(l, 0, LIGHT_STRENGTH) < layerOpacity(l, 0, 1));
      assert.ok(layerOpacity(l, 1, LIGHT_STRENGTH) > layerOpacity(l, 0, LIGHT_STRENGTH));
      assert.ok(layerOpacity(l, 1, 5) <= 1, 'never above 100 %');
    }
    assert.ok(LIGHT_STRENGTH > 0.3 && LIGHT_STRENGTH < 1);
  });

  it('behind the cover: one ribbon lies above, one below, so that both peek out around it; edges dissolve over a part of the box', () => {
    const by = Object.fromEntries(LAYERS.map((l) => [l.key, l.offsetY]));
    assert.ok(by.green < -0.1, 'green peeks out above');
    assert.ok(by.purple > 0.15, 'purple peeks out below');
    for (const l of LAYERS) assert.ok(Math.abs(l.offsetY) < 0.5, l.key);
    assert.ok(FADE_VERTICAL > 0.1 && FADE_VERTICAL < 0.45 && FADE_HORIZONTAL > 0.05 && FADE_HORIZONTAL < 0.3);
  });

  it('the three layers, bottom to top, as in the original design', () => {
    assert.deepEqual(LAYERS.map((l) => l.key), ['red', 'purple', 'green']);
    assert.deepEqual(LAYERS.map((l) => l.reverse), [false, true, false]);
  });

  it('the drift keyframes line up (same number of stops everywhere)', () => {
    for (const k of ['x', 'y', 'scale', 'rotateDeg'] as const) assert.equal(DRIFT[k].length, DRIFT.input.length, k);
    assert.deepEqual(DRIFT.input, [...DRIFT.input].sort((a, b) => a - b));
  });
});

describe('swiping the player down', () => {
  it('only a downward, mostly vertical drag starts it', () => {
    assert.equal(startsSwipeDown(0, 30), true);
    assert.equal(startsSwipeDown(5, 14), true);
    assert.equal(startsSwipeDown(0, 8), false, 'too small: it is a tap');
    assert.equal(startsSwipeDown(0, -40), false, 'upwards');
    assert.equal(startsSwipeDown(60, 40), false, 'sideways (a slider)');
    assert.equal(startsSwipeDown(30, 40), false, 'diagonal');
  });

  it('a long enough drag closes; a short one springs back', () => {
    assert.equal(swipeOutcome(200, 0.1, 800), 'close');
    assert.equal(swipeOutcome(141, 0, 800), 'close');
    assert.equal(swipeOutcome(100, 0.1, 800), 'back');
    assert.equal(swipeOutcome(0, 0, 800), 'back');
  });

  it('a quick flick closes without the full distance, but a tiny one does not', () => {
    assert.equal(swipeOutcome(60, 1.2, 800), 'close');
    assert.equal(swipeOutcome(20, 2, 800), 'back');
  });

  it('on a short screen the distance is a fifth of it', () => {
    assert.equal(swipeOutcome(110, 0, 500), 'close'); // 20 % of 500 = 100
    assert.equal(swipeOutcome(90, 0, 500), 'back');
  });
});

describe('version', () => {
  it('is 1.0.2 and the same in app.json, package.json and the Settings screen', () => {
    assert.equal(APP_VERSION, '1.0.2');
    const app = JSON.parse(readFileSync('app.json', 'utf8'));
    assert.equal(app.expo.version, APP_VERSION);
    assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).version, APP_VERSION);
    assert.ok(app.expo.android.versionCode >= 3, 'a higher build number than the earlier releases, so Android installs it as an update');
    assert.equal(String(app.expo.ios.buildNumber), String(app.expo.android.versionCode));
    assert.ok(readFileSync('app/(tabs)/settings.tsx', 'utf8').includes('APP_VERSION'), 'the Settings screen shows it');
  });
});
