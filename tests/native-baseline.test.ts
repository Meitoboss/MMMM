import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { BASELINE_FILE, inputsHash } from '../ota/native-baseline.mjs';

/**
 * The native part of the app, as far as the project files say: the packages it depends on, the settings that reach the native
 * project, and the script that patches a native package. `ota/native-baseline.json` holds this fingerprint as of the LAST BUILD
 * of the app (IPA / APK). While they are equal, a change can be delivered over the air.
 */
describe('is this version deliverable over the air?', () => {
  it('the native part is the same as in the last build – so a published update reaches every installed app', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    assert.equal(
      inputsHash('.'),
      baseline.hash,
      'The native part of the app changed (a package, a permission, a plugin …). That cannot be delivered over the air: build a new IPA / APK, and after that build is made run  node ota/native-baseline.mjs --write',
    );
  });

  it('the baseline file says what it is for', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    assert.match(baseline.hash, /^[0-9a-f]{16}$/);
    assert.match(baseline.note, /native-baseline\.mjs --write/);
  });

  it('the command says the same, in words', () => {
    const r = spawnSync(process.execPath, ['ota/native-baseline.mjs'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /同じです: この版は、OTAで届けられます/);
  });
});
