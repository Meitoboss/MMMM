// The native fingerprint of the project files (packages, settings that reach the native project, the native patch script).
//   node ota/native-baseline.mjs            prints it and says whether it equals ota/native-baseline.json
//   node ota/native-baseline.mjs --write    writes it into ota/native-baseline.json  (do this AFTER a new IPA / APK has been built)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { canonical, normalizedConfig } from './native-hash.mjs';

export const BASELINE_FILE = 'ota/native-baseline.json';
export const BASELINE_NOTE =
  'The native fingerprint of the project files at the time of the last IPA / APK build. While tests/native-baseline.test.ts passes, a new version can be delivered over the air. After a deliberate native change AND a new build, run: node ota/native-baseline.mjs --write';

export function inputsHash(root = '.') {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const app = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));
  const patchFile = path.join(root, 'scripts', 'patch-track-player.mjs'); // changes native code of a package
  const patch = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : '';
  return createHash('sha256').update(JSON.stringify(canonical({ dependencies: pkg.dependencies, config: normalizedConfig(app), patch }))).digest('hex').slice(0, 16);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const now = inputsHash('.');
  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE_FILE, `${JSON.stringify({ hash: now, note: BASELINE_NOTE }, null, 2)}\n`);
    console.log(`${BASELINE_FILE} に書きました: ${now}`);
  } else {
    const saved = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).hash : '(なし)';
    console.log(`いま: ${now}\n基準: ${saved}\n${now === saved ? '同じです: この版は、OTAで届けられます' : '違います: ネイティブが変わっています。新しい IPA / APK が必要です'}`);
  }
}
