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

/* ------------------------------------------------------------ talking to the server ------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** a server that is only busy or restarting: worth another try */
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
export const DEFAULT_RETRY_DELAYS = [2000, 5000, 10000];

/** why a request did not even get an answer – in words (Node only says "fetch failed"; the reason is inside) */
export function describeNetworkError(e, url) {
  const cause = e?.cause ?? {};
  const code = String(cause.code ?? e?.code ?? '');
  let host = url;
  try {
    host = new URL(url).host;
  } catch { /* not an address */ }
  let hint = '';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || code === 'UND_ERR_HEADERS_TIMEOUT') hint = '時間切れです（サーバーが応答しません）';
  else if (code === 'ECONNREFUSED') hint = '接続を断られました（サーバーか Caddy が止まっているようです）';
  else if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') hint = '応答がありません（サーバーが止まっているか、通信が届いていません）';
  else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') hint = 'アドレスが見つかりません（名前の解決に失敗しました）';
  else if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') hint = '接続が途中で切られました';
  else if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(String(cause.message ?? ''))) hint = '証明書の問題です';
  const detail = [code, cause.message && cause.message !== e?.message ? cause.message : ''].filter(Boolean).join(' ');
  return `${host} につながりません: ${hint || e?.message || String(e)}${detail ? `（${detail}）` : ''}`;
}

/** one request, retried when the network or a busy server fails; gives up with the reason */
async function request(fetchImpl, url, init, { what, timeoutMs, retryDelays, log }) {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retryDelays.length;
    try {
      const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!last && RETRY_STATUS.has(r.status)) {
        log(`${what}: サーバーが ${r.status} を返しました。${retryDelays[attempt] / 1000}秒後に、もう一度試します`);
        await sleep(retryDelays[attempt]);
        continue;
      }
      return r;
    } catch (e) {
      if (last) throw new Error(`${what}: ${describeNetworkError(e, url)}`);
      log(`${what}: ${describeNetworkError(e, url)} → ${retryDelays[attempt] / 1000}秒後に、もう一度試します`);
      await sleep(retryDelays[attempt]);
    }
  }
}

/** checks that the server answers, uploads the missing assets, then makes the update current */
export async function send({ server, token, publish, files, fetchImpl = fetch, log = () => {}, retryDelays = DEFAULT_RETRY_DELAYS }) {
  const base = server.replace(/\/+$/, '');
  const auth = { authorization: `Bearer ${token}` };
  const fail = async (what, r) => {
    let msg = '';
    try {
      msg = (await r.json()).error ?? '';
    } catch { /* not JSON */ }
    throw new Error(`${what} (${r.status}) ${msg}`.trim());
  };
  const ask = (url, init, what, timeoutMs) => request(fetchImpl, url, init, { what, timeoutMs, retryDelays, log });

  const health = await ask(`${base}/ota/health`, { method: 'GET' }, 'サーバーの確認', 15_000);
  if (!health.ok) await fail('サーバーが正常に答えません', health);
  log('サーバーは動いています');

  let missing = [];
  if (files.size) {
    const r = await ask(`${base}/ota/admin/assets/missing`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: [...files.keys()] }) }, '資産の問い合わせ', 30_000);
    if (!r.ok) await fail('サーバーに問い合わせできませんでした', r);
    missing = (await r.json()).missing;
  }
  log(`資産 ${files.size} 個のうち、アップロードが必要なのは ${missing.length} 個`);
  let done = 0;
  for (const hash of missing) {
    const f = files.get(hash);
    const r = await ask(`${base}/ota/admin/assets/${hash}`, { method: 'PUT', headers: { ...auth, 'x-asset-content-type': f.contentType, 'content-type': 'application/octet-stream' }, body: f.buffer }, `資産のアップロード (${hash.slice(0, 8)}…)`, 120_000);
    if (!r.ok) await fail(`資産のアップロードに失敗しました (${hash.slice(0, 8)}…)`, r);
    done++;
    if (done % 10 === 0 || done === missing.length) log(`アップロード ${done} / ${missing.length}`);
  }
  const r = await ask(`${base}/ota/admin/publish`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(publish) }, '公開', 60_000);
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
