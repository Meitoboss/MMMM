#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('Usage: npm run bump-version 1.0.3');
  process.exit(1);
}

const files = [
  { path: 'package.json', key: 'version' },
  { path: 'app.json', key: 'expo.version' },
  { path: 'src/appVersion.ts', isTypescript: true },
];

// bump package.json
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ package.json: ${newVersion}`);

// bump app.json
const appJsonPath = path.join(rootDir, 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
appJson.expo.version = newVersion;
appJson.expo.ios.buildNumber = String(parseInt(appJson.expo.ios.buildNumber) + 1);
appJson.expo.android.versionCode = parseInt(appJson.expo.android.versionCode) + 1;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');
console.log(`✓ app.json: ${newVersion} (iOS build: ${appJson.expo.ios.buildNumber}, Android code: ${appJson.expo.android.versionCode})`);

// bump appVersion.ts
const appVersionPath = path.join(rootDir, 'src/appVersion.ts');
const appVersionContent = fs.readFileSync(appVersionPath, 'utf8');
const newAppVersionContent = appVersionContent.replace(/export const APP_VERSION = '[^']+';/, `export const APP_VERSION = '${newVersion}';`);
fs.writeFileSync(appVersionPath, newAppVersionContent);
console.log(`✓ src/appVersion.ts: ${newVersion}`);

console.log('\n✅ All version files updated to', newVersion);
