#!/usr/bin/env node
/**
 * react-native-track-player 4.1.x does not compile with Kotlin 2.x (React Native 0.80+ / Expo SDK 54):
 *   MusicModule.kt:  Arguments.fromBundle(track.originalItem)   – originalItem is `Bundle?`, fromBundle needs `Bundle`
 *   (doublesymmetry/react-native-track-player issues #2579, #2604; no fixed release yet)
 * This rewrites those calls to `Arguments.fromBundle(track.originalItem ?: android.os.Bundle())`.
 * It only touches the Android Kotlin source, is safe to run repeatedly, and does nothing when the file is not there.
 *
 *   node scripts/patch-track-player.mjs [node_modules-folder]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const modules = process.argv[2] ?? 'node_modules';
const file = join(modules, 'react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt');

if (!existsSync(file)) {
  console.log(`patch-track-player: ${file} not found – nothing to do`);
  process.exit(0);
}

const original = readFileSync(file, 'utf8');
let count = 0;

/**
 * Finds every `Arguments.fromBundle(<expr>)` – the expression may itself contain brackets and calls, so the closing
 * parenthesis is found by counting – and, when <expr> ends in `.originalItem`, gives it a fallback.
 */
function patchSource(src) {
  const needle = 'Arguments.fromBundle(';
  let out = '';
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at < 0) break;
    const start = at + needle.length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    const end = i - 1; // index of the matching ")"
    const expr = src.slice(start, end);
    out += src.slice(from, start);
    if (depth === 0 && expr.trim().endsWith('.originalItem') && !expr.includes('?:') && !expr.includes('?.')) {
      out += `${expr.trim()} ?: android.os.Bundle()`;
      count += 1;
    } else {
      out += expr;
    }
    from = end; // the ")" itself is copied with the next chunk
  }
  return out + src.slice(from);
}

const patched = patchSource(original);

if (count > 0) {
  writeFileSync(file, patched);
  console.log(`patch-track-player: fixed ${count} call(s) in MusicModule.kt`);
} else if (original.includes('?: android.os.Bundle()')) {
  console.log('patch-track-player: already patched');
} else {
  const lines = original
    .split('\n')
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.includes('fromBundle('))
    .map(({ l, n }) => `  ${n}: ${l.trim()}`);
  console.log(`patch-track-player: expected pattern not found (the library may already be fixed). fromBundle calls:\n${lines.join('\n') || '  (none)'}`);
}
