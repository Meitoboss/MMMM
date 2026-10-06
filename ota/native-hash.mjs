// A fingerprint of the NATIVE part of a build: which native packages (and versions) it contains, and the app settings that
// reach the native project. An app sends it with every update request; the server only answers with updates made on a
// project that has the same fingerprint. So a JS update can never reach an app whose native code it does not fit.
// Not part of it: the version label, name, ids, icons, and everything JavaScript-only.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** keys of the "expo" section of app.json that do not change the native project */
const NOT_NATIVE = ['version', 'description', 'runtimeVersion', 'updates', 'extra', 'name', 'slug'];
/** always part of it, native code or not: the JS side must match them too */
const ALWAYS = ['expo', 'react-native', 'react'];

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}

export function normalizedConfig(app) {
  const e = JSON.parse(JSON.stringify(app.expo ?? {}));
  for (const k of NOT_NATIVE) delete e[k];
  if (e.ios) {
    delete e.ios.buildNumber;
    delete e.ios.bundleIdentifier;
  }
  if (e.android) {
    delete e.android.versionCode;
    delete e.android.package;
  }
  return canonical(e);
}

function isNativePackage(dir) {
  for (const f of ['ios', 'android', 'expo-module.config.json', 'react-native.config.js']) if (existsSync(path.join(dir, f))) return true;
  try {
    return readdirSync(dir).some((f) => f.endsWith('.podspec'));
  } catch {
    return false;
  }
}

/** "name@version" of every installed package that has native code (top level of node_modules), sorted */
export function listNativePackages(root) {
  const nm = path.join(root, 'node_modules');
  const found = new Set();
  const look = (dir) => {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      return;
    }
    if (pkg.name && pkg.version && (ALWAYS.includes(pkg.name) || isNativePackage(dir))) found.add(`${pkg.name}@${pkg.version}`);
  };
  let names = [];
  try {
    names = readdirSync(nm, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const n of names) {
    if (n.name.startsWith('.')) continue;
    if (n.name.startsWith('@')) {
      for (const s of readdirSync(path.join(nm, n.name), { withFileTypes: true })) look(path.join(nm, n.name, s.name));
    } else {
      look(path.join(nm, n.name));
    }
  }
  return [...found].sort();
}

export function computeNativeHash({ root = '.' } = {}) {
  const app = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));
  const patchFile = path.join(root, 'scripts', 'patch-track-player.mjs'); // changes native Kotlin of a package
  const material = JSON.stringify({ packages: listNativePackages(root), config: normalizedConfig(app), patch: existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : '' });
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  console.log(computeNativeHash({ root: process.argv[2] ?? '.' }));
}
