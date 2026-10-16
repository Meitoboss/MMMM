import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FOCUS_SOUNDS, focusFileName, focusIssueUrl } from '../src/core/focus';

describe('focus sounds on the server', () => {
  it('names each sound as a flac file', () => {
    assert.equal(focusFileName('focus_loop'), 'focus_loop.flac');
    assert.equal(FOCUS_SOUNDS.length, 12);
  });

  it('asks for a signed address for the right path, without a double slash', () => {
    assert.equal(
      focusIssueUrl('https://130-210-45-154.sslip.io/', 'focus_loop'),
      'https://130-210-45-154.sslip.io/issue?path=%2Faudio%2Ffocus_loop.flac&ttl=3600',
    );
  });
});
