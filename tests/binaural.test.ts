import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeMix, MAX_BEAT_HZ, type MixInput, STRENGTH } from '../src/core/binaural';
import { PRESETS } from '../src/core/binauralPresets';

const base: MixInput = { strength: 'normal', noise: 'off', headphones: true, speakerMode: 'stop', center: 200, beat: 20 };

describe('the tone on headphones', () => {
  it('normal is about ANIMA’s Normal (0.6), and the environment sound is not made quieter', () => {
    const mix = computeMix(base);
    assert.equal(mix.ambient, 1);
    assert.equal(mix.tone?.toneVolume, 0.6);
    assert.equal(mix.tone?.center, 200);
    assert.equal(mix.tone?.beat, 20);
  });

  it('the levels rise: low < normal < high, and none is silent', () => {
    assert.equal(STRENGTH.off, 0);
    assert.ok(STRENGTH.low < STRENGTH.normal && STRENGTH.normal < STRENGTH.high);
    assert.equal(computeMix({ ...base, strength: 'off' }).tone, null);
  });

  it('the noise is a share of the tone, and off means none', () => {
    assert.equal(computeMix({ ...base, noise: 'off' }).tone?.noiseVolume, 0);
    const high = computeMix({ ...base, noise: 'high' }).tone;
    assert.ok(high && high.noiseVolume > 0 && high.noiseVolume < high.toneVolume);
  });

  it('the beat never goes past the limit', () => {
    assert.equal(computeMix({ ...base, beat: 50 }).tone?.beat, MAX_BEAT_HZ);
  });
});

describe('the tone on speakers', () => {
  it('stop: the tone is off', () => {
    const mix = computeMix({ ...base, headphones: false, speakerMode: 'stop' });
    assert.equal(mix.tone, null);
    assert.equal(mix.ambient, 1);
  });

  it('shift: the tone is raised by 100 Hz and keeps playing', () => {
    const mix = computeMix({ ...base, headphones: false, speakerMode: 'shift' });
    assert.equal(mix.tone?.center, 300);
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
