import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (f: string) => readFileSync(f, 'utf8');
const at = (text: string, needle: string) => {
  const i = text.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  return i;
};

describe('the build workflows set the app up for updates before the native project is made', () => {
  for (const [file, generate] of [['.github/workflows/ios-ipa.yml', 'Generate the native iOS project'], ['.github/workflows/android-apk.yml', 'Generate the native Android project']] as const) {
    it(file, () => {
      const t = read(file);
      const align = at(t, 'Align native module versions');
      const apply = at(t, 'node scripts/apply-ota.mjs --variant ${{ inputs.variant || \'prod\' }}');
      const gen = at(t, generate);
      assert.ok(align < apply && apply < gen, 'after the packages are aligned, before the native project is generated');
      assert.ok(t.includes('options: [prod, trial]') && t.includes('default: prod'), 'prod is the default');
      assert.ok(t.includes("inputs.variant == 'trial' &&"), 'the trial build has its own artifact name');
    });
  }
  it('only real (tagged) releases are attached to a GitHub release – never the trial build', () => {
    for (const f of ['.github/workflows/ios-ipa.yml', '.github/workflows/android-apk.yml']) {
      const t = read(f);
      assert.ok(t.includes("if: startsWith(github.ref, 'refs/tags/v')"), f);
      assert.ok(!t.includes('inputs.variant') || !t.slice(at(t, 'softprops')).includes('trial'), f);
    }
  });
});

describe('the publish and roll-back workflows', () => {
  const pub = read('.github/workflows/ota-publish.yml');
  const rb = read('.github/workflows/ota-rollback.yml');
  it('prepare the project exactly as the build does, in the same order', () => {
    for (const t of [pub, rb]) {
      const order = ['npm install', 'tests/lint.test.ts', 'fetch-solver', 'npx expo install --fix', 'scripts/apply-ota.mjs'].map((n) => at(t, n));
      assert.deepEqual(order, [...order].sort((a, b) => a - b));
    }
  });
  it('export both platforms, then sign and publish with the two secrets', () => {
    assert.ok(at(pub, 'expo export --platform all --output-dir dist') < at(pub, 'ota/publish.mjs update'));
    for (const t of [pub, rb]) {
      assert.ok(t.includes('secrets.OTA_ADMIN_TOKEN') && t.includes('secrets.OTA_PRIVATE_KEY'));
      assert.ok(!/OTA_PRIVATE_KEY:\s*['"]?-----/.test(t), 'no key in the file');
    }
    assert.ok(pub.includes('--expo-config expo-config.json') && pub.includes('expo config --json --type public'));
    assert.ok(rb.includes('ota/publish.mjs rollback'));
  });
  it('are started by hand only, and offer the two channels with trial first', () => {
    for (const t of [pub, rb]) {
      assert.ok(t.includes('options: [trial, main]') && t.includes('default: trial'));
      assert.ok(!/\n {2}push:/.test(t), 'no automatic start');
    }
  });
  it('every file they use exists', () => {
    for (const f of ['scripts/apply-ota.mjs', 'ota/publish.mjs', 'ota/native-hash.mjs', 'ota/lib.mjs', 'ota/server.mjs', 'ota/config.json', 'tests/lint.test.ts']) assert.ok(existsSync(f), f);
  });
});
