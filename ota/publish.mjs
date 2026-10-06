// Builds an update from the folder that `expo export` made, signs it, and sends it to the update server.
//   node ota/publish.mjs update   --dist dist --channel trial --server https://… [--expo-config expo-config.json] [--runtime 1] [--native-hash …]
//   node ota/publish.mjs rollback --channel trial --server https://…           (back to the version inside the installed app)
// Secrets come from the environment: OTA_ADMIN_TOKEN (upload), OTA_PRIVATE_KEY (signing, PEM text).
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildPlatformManifest, buildRollbackDirective, signRsaSha256, signatureHeader } from './lib.mjs';
import { computeNativeHash } from './native-hash.mjs';

const sign = (body, key, keyId) => (key ? signatureHeader(signRsaSha256(body, key), keyId) : null);

/** everything one update needs; `files` are the assets to upload (by hash) */
export function buildUpdate({ distDir, channel, runtimeVersion, nativeHash, baseUrl, privateKeyPem, expoClient, now = new Date(), id = randomUUID(), keyId = 'main', platforms = ['ios', 'android'] }) {
  const metadata = JSON.parse(readFileSync(path.join(distDir, 'metadata.json'), 'utf8'));
  const fm = metadata.fileMetadata;
  if (!fm || typeof fm !== 'object') throw new Error('metadata.json に fileMetadata がありません（expo export の出力ではないようです）');
  const createdAt = now.toISOString();
  const root = path.resolve(distDir);
  const readFile = (rel) => {
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`書き出しフォルダの外のファイルは使えません: ${rel}`);
    return readFileSync(full);
  };
  const files = new Map();
  const out = {};
  for (const platform of platforms) {
    if (!fm[platform]) throw new Error(`${platform} の書き出しがありません（--platform all で expo export しましたか？）`);
    const built = buildPlatformManifest({ id, createdAt, runtimeVersion, meta: fm[platform], readFile, baseUrl, expoClient });
    for (const [hash, f] of built.files) files.set(hash, f);
    const body = JSON.stringify(built.manifest);
    out[platform] = { body, signature: sign(body, privateKeyPem, keyId) };
  }
  return { publish: { channel, runtimeVersion, nativeHash, kind: 'update', id, createdAt, platforms: out }, files };
}

/** "go back to the version that is inside the installed app" */
export function buildRollback({ channel, runtimeVersion, nativeHash, privateKeyPem, now = new Date(), keyId = 'main', platforms = ['ios', 'android'] }) {
  const createdAt = now.toISOString();
  const body = JSON.stringify(buildRollbackDirective(createdAt));
  const out = {};
  for (const platform of platforms) out[platform] = { body, signature: sign(body, privateKeyPem, keyId) };
  return { publish: { channel, runtimeVersion, nativeHash, kind: 'rollback', createdAt, platforms: out }, files: new Map() };
}

/** uploads the missing assets, then makes the update current */
export async function send({ server, token, publish, files, fetchImpl = fetch, log = () => {} }) {
  const base = server.replace(/\/+$/, '');
  const auth = { authorization: `Bearer ${token}` };
  const fail = async (what, r) => {
    let msg = '';
    try {
      msg = (await r.json()).error ?? '';
    } catch { /* not JSON */ }
    throw new Error(`${what} (${r.status}) ${msg}`.trim());
  };
  let missing = [];
  if (files.size) {
    const r = await fetchImpl(`${base}/ota/admin/assets/missing`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: [...files.keys()] }) });
    if (!r.ok) await fail('サーバーに問い合わせできませんでした', r);
    missing = (await r.json()).missing;
  }
  log(`資産 ${files.size} 個のうち、アップロードが必要なのは ${missing.length} 個`);
  for (const hash of missing) {
    const f = files.get(hash);
    const r = await fetchImpl(`${base}/ota/admin/assets/${hash}`, { method: 'PUT', headers: { ...auth, 'x-asset-content-type': f.contentType, 'content-type': 'application/octet-stream' }, body: f.buffer });
    if (!r.ok) await fail(`資産のアップロードに失敗しました (${hash.slice(0, 8)}…)`, r);
  }
  const r = await fetchImpl(`${base}/ota/admin/publish`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(publish) });
  if (!r.ok) await fail('公開できませんでした', r);
  return r.json();
}

/* ------------------------------------------------------------ command line ------------------------------------------------------------ */
async function main() {
  const [cmd] = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const die = (m) => {
    console.error(`エラー: ${m}`);
    process.exit(1);
  };
  const config = JSON.parse(readFileSync('ota/config.json', 'utf8'));
  const server = arg('server', config.serverBase);
  const channel = arg('channel');
  const runtimeVersion = arg('runtime', config.runtimeVersion);
  const variant = channel === 'main' ? 'prod' : 'trial';
  if (!(config.enabledFor ?? []).includes(variant)) die(`${channel} はまだ有効ではありません（ota/config.json の enabledFor に "${variant}" がありません）`);
  const token = process.env.OTA_ADMIN_TOKEN;
  const privateKeyPem = process.env.OTA_PRIVATE_KEY || null;
  if (!channel) die('--channel が必要です');
  if (!token) die('OTA_ADMIN_TOKEN がありません（GitHub の Secrets に入れてください）');
  if (!privateKeyPem && process.env.OTA_ALLOW_UNSIGNED !== '1') die('OTA_PRIVATE_KEY がありません（署名のない更新は、署名を確認するアプリでは拒否されます）');
  const nativeHash = arg('native-hash') ?? computeNativeHash({ root: '.' });
  console.log(`channel=${channel} runtime=${runtimeVersion} native=${nativeHash} server=${server}`);
  let built;
  if (cmd === 'update') {
    const expoConfigFile = arg('expo-config');
    built = buildUpdate({
      distDir: arg('dist', 'dist'), channel, runtimeVersion, nativeHash, baseUrl: server, privateKeyPem,
      expoClient: expoConfigFile && existsSync(expoConfigFile) ? JSON.parse(readFileSync(expoConfigFile, 'utf8')) : {},
    });
  } else if (cmd === 'rollback') {
    built = buildRollback({ channel, runtimeVersion, nativeHash, privateKeyPem });
  } else {
    die('update か rollback を指定してください');
  }
  const result = await send({ server, token, publish: built.publish, files: built.files, log: console.log }).catch((e) => die(e.message));
  console.log(`公開しました: ${JSON.stringify(result)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  });
}
