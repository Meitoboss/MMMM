import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AMBIENT_COEF, BINAURAL_COEF, computeMix, normalizeCoefs, sliderToVolume, STRENGTH, MAX_BEAT_HZ, type MixInput } from '../src/core/binaural';
import { PRESETS } from '../src/core/binauralPresets';

const base: MixInput = { strength: 'normal', noise: 'off', headphones: true, speakerMode: 'stop', center: 200, beat: 20 };

describe('the shares of the volume', () => {
  it('the start values add up to 1 or less, and a too-large pair is scaled down together', () => {
    assert.ok(AMBIENT_COEF + BINAURAL_COEF <= 1);
    const fixed = normalizeCoefs(0.9, 0.5);
    assert.ok(Math.abs(fixed.ambient + fixed.binaural - 1) < 1e-9);
    assert.ok(Math.abs(fixed.ambient / fixed.binaural - 0.9 / 0.5) < 1e-9);
  });

  it('the slider is squared', () => {
    assert.equal(sliderToVolume(0), 0);
    assert.equal(sliderToVolume(0.5), 0.25);
    assert.equal(sliderToVolume(2), 1);
  });
});

describe('the mix on headphones', () => {
  it('the tone is strength × 0.3, and the environment sound gets 0.7', () => {
    const mix = computeMix(base);
    assert.equal(mix.ambient, AMBIENT_COEF);
    assert.ok(mix.tone);
    assert.ok(Math.abs(mix.tone.toneVolume - STRENGTH.normal * BINAURAL_COEF) < 1e-9);
    assert.equal(mix.tone.center, 200);
    assert.equal(mix.tone.beat, 20);
  });

  it('the noise is a share of the tone, and off means none', () => {
    assert.equal(computeMix({ ...base, noise: 'off' }).tone?.noiseVolume, 0);
    const high = computeMix({ ...base, noise: 'high' }).tone;
    assert.ok(high && high.noiseVolume > 0 && high.noiseVolume < high.toneVolume);
  });

  it('the beat never goes past the limit', () => {
    assert.equal(computeMix({ ...base, beat: 50 }).tone?.beat, MAX_BEAT_HZ);
  });

  it('the highest strength stays within the 0.21 amplitude of the design', () => {
    const top = computeMix({ ...base, strength: 'high' }).tone;
    assert.ok(top && Math.abs(top.toneVolume - 0.21) < 1e-9);
  });
});

describe('the mix on speakers', () => {
  it('stop: the tone is off, and the environment sound is not made quieter', () => {
    const mix = computeMix({ ...base, headphones: false, speakerMode: 'stop' });
    assert.equal(mix.tone, null);
    assert.equal(mix.ambient, 1);
  });

  it('shift: the tone is raised by 100 Hz and keeps playing', () => {
    const mix = computeMix({ ...base, headphones: false, speakerMode: 'shift' });
    assert.equal(mix.tone?.center, 300);
    assert.equal(mix.ambient, AMBIENT_COEF);
  });

  it('off strength: no tone, whatever the output', () => {
    assert.equal(computeMix({ ...base, strength: 'off' }).tone, null);
  });
});

describe('the scenes', () => {
  it('each scene stays within the ranges of the design, and its beat is at most a tenth of the pitch', () => {
    const ranges: Record<string, [number, number, number, number]> = {
      sleep: [100, 200, 1, 5],
      relax: [150, 200, 5, 10],
      focus: [200, 250, 15, 20],
    };
    for (const p of PRESETS) {
      const [cMin, cMax, bMin, bMax] = ranges[p.key];
      assert.ok(p.center >= cMin && p.center <= cMax, `${p.key} center`);
      assert.ok(p.beat >= bMin && p.beat <= bMax, `${p.key} beat`);
      assert.ok(p.beat <= p.center * 0.1, `${p.key} beat is more than a tenth of the pitch`);
    }
  });
});
