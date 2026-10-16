import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FOCUS_SOUNDS, focusFileName, focusHzOf, focusIssueUrl, toneVolume } from '../src/core/focus';

describe('focus sounds on the server', () => {
  it('names each sound as a flac file', () => {
    assert.equal(focusFileName('focus_loop'), 'focus_loop.flac');
  });

  it('asks for a signed address for the right path, without a double slash', () => {
    assert.equal(
      focusIssueUrl('https://130-210-45-154.sslip.io/', 'focus_loop'),
      'https://130-210-45-154.sslip.io/issue?path=%2Faudio%2Ffocus_loop.flac&ttl=3600',
    );
  });
});

describe('sine tone for each focus sound', () => {
  it('has a height for every sound, and the loudness is one of the four levels', () => {
    for (const s of FOCUS_SOUNDS) assert.ok(s.hz > 0);
    assert.equal(focusHzOf('unknown'), undefined);
    assert.equal(focusHzOf('unknown'), undefined);
  });

  it('turns the chosen level into a volume: none is silent, normal is the default', () => {
    assert.equal(toneVolume('off'), 0);
    assert.ok(toneVolume('low') < toneVolume('normal'));
    assert.ok(toneVolume('normal') < toneVolume('high'));
  });
});
