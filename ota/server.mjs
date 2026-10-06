// Expo Updates (protocol v1) server for Music space. Plain Node, no dependencies, small enough for a 128 MB container.
//
// The server only STORES and SERVES what CI has built and signed. It never holds the signing key, so a hacked server
// cannot make an update the apps would accept. Updates are looked up by: channel (in the address), the app's runtime
// version and the fingerprint of its native part (`x-native-hash`, set in the app at build time), and the platform.
//
//   GET  /ota/<channel>/manifest            the apps (headers: expo-platform, expo-runtime-version, x-native-hash …)
//   GET  /ota/assets/<hash>                 the apps (bundle, images, fonts – by their SHA-256)
//   GET  /ota/health
//   POST /ota/admin/assets/missing          CI (Bearer token): which of these hashes are not stored yet?
//   PUT  /ota/admin/assets/<hash>           CI: store one file (checked against its hash)
//   POST /ota/admin/publish                 CI: make an update / a rollback current
//   GET  /ota/admin/status                  you
import { X509Certificate, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  isAssetHash, isChannel, isIsoDate, isMime, isNativeHash, isPlatform, isRuntimeVersion, isUuid,
  multipartBody, newBoundary, parseSignatureHeader, verifyRsaSha256,
} from './lib.mjs';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const single = (v) => (Array.isArray(v) ? v[0] : v);
const MB = 1024 * 1024;

export function createOtaServer(cfg) {
  const c = { keep: 10, maxAssetBytes: 80 * MB, maxJsonBytes: 2 * MB, gcMinAgeMs: 3_600_000, log: () => {}, certPem: null, ...cfg };
  if (!c.dataDir || !c.publicBase) throw new Error('dataDir and publicBase are needed');
  if (typeof c.adminToken !== 'string' || c.adminToken.length < 16) throw new Error('adminToken must be at least 16 characters');
  const publicBase = c.publicBase.replace(/\/+$/, '');
  const cert = c.certPem ? new X509Certificate(c.certPem) : null;
  const dir = { assets: path.join(c.dataDir, 'assets'), current: path.join(c.dataDir, 'current'), history: path.join(c.dataDir, 'history'), tmp: path.join(c.dataDir, 'tmp') };
  const seen = new Map(); // "channel|runtime|hash|platform" → { count, last }
  const tokenDigest = createHash('sha256').update(c.adminToken).digest();

  /* ------------------------------------------------------------ small helpers ------------------------------------------------------------ */
  const json = (res, status, obj, extra = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', ...extra });
    res.end(body);
  };

  async function readJsonFile(file) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async function writeJsonAtomic(file, obj) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = path.join(dir.tmp, `${randomBytes(8).toString('hex')}.json`);
    await mkdir(dir.tmp, { recursive: true });
    await writeFile(tmp, JSON.stringify(obj));
    await rename(tmp, file);
  }

  async function readBody(req, limit) {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) throw new HttpError(413, 'too large');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, 'too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function readJsonBody(req) {
    const buf = await readBody(req, c.maxJsonBytes);
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      throw new HttpError(400, 'JSON として読めません');
    }
  }

  function requireAdmin(req) {
    const m = /^Bearer (.+)$/.exec(single(req.headers.authorization) ?? '');
    const given = createHash('sha256').update(m ? m[1] : '').digest();
    if (!m || !timingSafeEqual(given, tokenDigest)) throw new HttpError(401, 'unauthorized');
  }

  const pointerFile = (channel, runtime, nativeHash, platform) => path.join(dir.current, channel, runtime, nativeHash, `${platform}.json`);
  const historyDir = (channel, runtime, nativeHash, platform) => path.join(dir.history, channel, runtime, nativeHash, platform);
  const assetFile = (hash) => path.join(dir.assets, hash);
  const exists = async (file) => stat(file).then(() => true, () => false);

  /* ------------------------------------------------------------ for the apps ------------------------------------------------------------ */
  async function manifest(req, res, channel) {
    if (req.method !== 'GET') throw new HttpError(405, 'GET only');
    const h = req.headers;
    const protocol = Number.parseInt(single(h['expo-protocol-version']) ?? '0', 10) >= 1 ? 1 : 0;
    const platform = single(h['expo-platform']);
    const runtime = single(h['expo-runtime-version']);
    const nativeHash = single(h['x-native-hash']);
    if (!isPlatform(platform)) throw new HttpError(400, 'expo-platform は ios か android です');
    if (!isRuntimeVersion(runtime)) throw new HttpError(400, 'expo-runtime-version が正しくありません');
    if (!isNativeHash(nativeHash)) throw new HttpError(400, 'x-native-hash が必要です');
    const key = `${channel}|${runtime}|${nativeHash}|${platform}`;
    const s = seen.get(key) ?? { count: 0, last: '' };
    seen.set(key, { count: s.count + 1, last: new Date().toISOString() });

    const common = { 'expo-protocol-version': String(protocol), 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0' };
    const rec = await readJsonFile(pointerFile(channel, runtime, nativeHash, platform));
    if (!rec) {
      res.writeHead(204, common); // nothing to offer: a no-op for the app
      return res.end();
    }

    const accept = (single(h.accept) ?? '*/*').toLowerCase();
    const wantsMultipart = accept.includes('multipart/mixed') || accept.includes('*/*');
    const wantsJson = accept.includes('application/expo+json') || accept.includes('application/json');
    const expectSignature = Boolean(single(h['expo-expect-signature']));
    if (expectSignature && !rec.signature) throw new HttpError(400, 'この更新は署名されていません（アプリは署名つきの更新だけを受け取ります）');

    if (rec.kind === 'rollback') {
      if (protocol < 1) {
        res.writeHead(204, common);
        return res.end();
      }
      const embedded = single(h['expo-embedded-update-id']);
      if (embedded && single(h['expo-current-update-id']) === embedded) {
        res.writeHead(204, common); // already running the embedded version
        return res.end();
      }
      if (!wantsMultipart) throw new HttpError(406, 'multipart/mixed が必要です');
      const boundary = newBoundary();
      const body = multipartBody([{ name: 'directive', headers: { 'content-type': 'application/json; charset=utf-8', ...(expectSignature ? { 'expo-signature': rec.signature } : {}) }, body: rec.body }], boundary);
      res.writeHead(200, { ...common, 'expo-protocol-version': '1', 'content-type': `multipart/mixed; boundary=${boundary}`, 'content-length': body.length });
      return res.end(body);
    }

    if (wantsMultipart) {
      const boundary = newBoundary();
      const body = multipartBody(
        [
          { name: 'manifest', headers: { 'content-type': 'application/json; charset=utf-8', ...(expectSignature ? { 'expo-signature': rec.signature } : {}) }, body: rec.body },
          { name: 'extensions', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetRequestHeaders: {} }) },
        ],
        boundary,
      );
      res.writeHead(200, { ...common, 'content-type': `multipart/mixed; boundary=${boundary}`, 'content-length': body.length });
      return res.end(body);
    }
    if (wantsJson) {
      res.writeHead(200, { ...common, 'content-type': 'application/expo+json', 'content-length': Buffer.byteLength(rec.body), ...(expectSignature ? { 'expo-signature': rec.signature } : {}) });
      return res.end(rec.body);
    }
    throw new HttpError(406, 'Accept に対応していません');
  }

  async function asset(req, res, hash) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'GET only');
    if (!isAssetHash(hash)) throw new HttpError(404, 'not found');
    const meta = await readJsonFile(`${assetFile(hash)}.json`);
    const st = meta ? await stat(assetFile(hash)).catch(() => null) : null;
    if (!meta || !st) throw new HttpError(404, 'not found');
    const headers = { 'content-type': meta.contentType, 'cache-control': 'public, max-age=31536000, immutable', etag: `"${hash}"`, 'content-length': st.size };
    if (single(req.headers['if-none-match']) === `"${hash}"`) {
      res.writeHead(304, { etag: headers.etag, 'cache-control': headers['cache-control'] });
      return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = (await import('node:fs')).createReadStream(assetFile(hash));
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  /* ------------------------------------------------------------ for CI ------------------------------------------------------------ */
  async function missingAssets(req, res) {
    requireAdmin(req);
    const body = await readJsonBody(req);
    if (!Array.isArray(body.hashes) || body.hashes.length > 5000 || !body.hashes.every(isAssetHash)) throw new HttpError(400, 'hashes が正しくありません');
    const missing = [];
    for (const h of new Set(body.hashes)) if (!(await exists(`${assetFile(h)}.json`)) || !(await exists(assetFile(h)))) missing.push(h);
    json(res, 200, { missing });
  }

  async function putAsset(req, res, hash) {
    requireAdmin(req);
    if (req.method !== 'PUT') throw new HttpError(405, 'PUT only');
    if (!isAssetHash(hash)) throw new HttpError(400, 'ハッシュが正しくありません');
    const contentType = single(req.headers['x-asset-content-type']);
    if (!isMime(contentType)) throw new HttpError(400, 'x-asset-content-type が正しくありません');
    if (Number(req.headers['content-length'] ?? 0) > c.maxAssetBytes) throw new HttpError(413, 'too large');
    await mkdir(dir.tmp, { recursive: true });
    await mkdir(dir.assets, { recursive: true });
    const tmp = path.join(dir.tmp, `${randomBytes(8).toString('hex')}.part`);
    const sha = createHash('sha256');
    const out = createWriteStream(tmp);
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > c.maxAssetBytes) throw new HttpError(413, 'too large');
        sha.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
      if (sha.digest('base64url') !== hash) throw new HttpError(400, '中身のハッシュが一致しません（壊れたアップロード）');
      await rename(tmp, assetFile(hash));
      await writeJsonAtomic(`${assetFile(hash)}.json`, { contentType, size });
      json(res, 201, { hash, size });
    } catch (e) {
      out.destroy();
      await rm(tmp, { force: true });
      throw e;
    }
  }

  function checkSignature(body, signature) {
    if (!cert) return signature ? String(signature) : null; // no certificate configured: stored as given
    const parsed = parseSignatureHeader(signature);
    if (!parsed || !verifyRsaSha256(body, parsed.sig, cert.publicKey)) throw new HttpError(422, '署名が証明書と合いません（鍵と証明書の組み合わせを確認してください）');
    return signature;
  }

  async function publish(req, res) {
    requireAdmin(req);
    const p = await readJsonBody(req);
    const { channel, runtimeVersion, nativeHash, kind, createdAt } = p;
    if (!isChannel(channel)) throw new HttpError(400, 'channel が正しくありません');
    if (!isRuntimeVersion(runtimeVersion)) throw new HttpError(400, 'runtimeVersion が正しくありません');
    if (!isNativeHash(nativeHash)) throw new HttpError(400, 'nativeHash が正しくありません');
    if (kind !== 'update' && kind !== 'rollback') throw new HttpError(400, 'kind は update か rollback です');
    if (!isIsoDate(createdAt)) throw new HttpError(400, 'createdAt が正しくありません');
    if (kind === 'update' && !isUuid(p.id)) throw new HttpError(400, 'id が正しくありません');
    const platforms = Object.keys(p.platforms ?? {});
    if (!platforms.length || !platforms.every(isPlatform)) throw new HttpError(400, 'platforms が正しくありません');

    const records = [];
    for (const platform of platforms) {
      const { body, signature } = p.platforms[platform] ?? {};
      if (typeof body !== 'string' || body.length > 800_000) throw new HttpError(400, `${platform}: body が正しくありません`);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new HttpError(400, `${platform}: body が JSON ではありません`);
      }
      if (kind === 'update') {
        if (parsed.id !== p.id || parsed.runtimeVersion !== runtimeVersion || parsed.createdAt !== createdAt) throw new HttpError(422, `${platform}: 更新の情報（id・runtimeVersion・createdAt）が一致しません`);
        const all = [parsed.launchAsset, ...(Array.isArray(parsed.assets) ? parsed.assets : [])];
        if (all.length > 2001) throw new HttpError(422, `${platform}: 資産が多すぎます`);
        const missing = [];
        for (const a of all) {
          if (!a || !isAssetHash(a.hash) || !isMime(a.contentType) || typeof a.key !== 'string' || a.key.length > 64) throw new HttpError(422, `${platform}: 資産の情報が正しくありません`);
          if (a.fileExtension !== undefined && !(typeof a.fileExtension === 'string' && /^\.[A-Za-z0-9]{1,12}$/.test(a.fileExtension))) throw new HttpError(422, `${platform}: 拡張子が正しくありません`);
          if (a.url !== `${publicBase}/ota/assets/${a.hash}`) throw new HttpError(422, `${platform}: 資産のアドレスがこのサーバーのものではありません`);
          if (!(await exists(assetFile(a.hash)))) missing.push(a.hash);
        }
        if (missing.length) throw new HttpError(422, `${platform}: まだ保存されていない資産があります（${missing.length}個）`);
      } else if (parsed.type !== 'rollBackToEmbedded' || parsed.parameters?.commitTime !== createdAt) {
        throw new HttpError(422, `${platform}: ロールバックの指示が正しくありません`);
      }
      const stored = checkSignature(body, signature);
      const old = await readJsonFile(pointerFile(channel, runtimeVersion, nativeHash, platform));
      if (old && Date.parse(old.createdAt) > Date.parse(createdAt)) throw new HttpError(409, `${platform}: いまの更新より古い日時です（アプリは新しい日時の更新だけを受け取ります）`);
      records.push({ platform, rec: { kind, id: kind === 'update' ? p.id : null, createdAt, body, signature: stored } });
    }

    for (const { platform, rec } of records) {
      await writeJsonAtomic(pointerFile(channel, runtimeVersion, nativeHash, platform), rec);
      const hd = historyDir(channel, runtimeVersion, nativeHash, platform);
      await writeJsonAtomic(path.join(hd, `${String(Date.parse(createdAt)).padStart(14, '0')}-${rec.id ?? 'rollback'}.json`), rec);
      const names = (await readdir(hd)).filter((n) => n.endsWith('.json')).sort().reverse();
      for (const old of names.slice(c.keep)) await rm(path.join(hd, old), { force: true });
    }
    const removed = await collectGarbage();
    c.log(`published ${kind} ${p.id ?? ''} channel=${channel} runtime=${runtimeVersion} native=${nativeHash} platforms=${platforms.join(',')} removedAssets=${removed}`);
    json(res, 200, { ok: true, kind, id: p.id ?? null, platforms, removedAssets: removed });
  }

  /** every file that a current or recent update still points at is kept; the rest (older than an hour, so uploads in progress are safe) goes */
  async function collectGarbage() {
    const wanted = new Set();
    const walk = async (base) => {
      let names = [];
      try {
        names = await readdir(base, { withFileTypes: true });
      } catch {
        return;
      }
      for (const n of names) {
        const full = path.join(base, n.name);
        if (n.isDirectory()) await walk(full);
        else if (n.name.endsWith('.json')) {
          const rec = await readJsonFile(full).catch(() => null);
          if (rec?.kind === 'update') {
            try {
              const m = JSON.parse(rec.body);
              for (const a of [m.launchAsset, ...(m.assets ?? [])]) if (a?.hash) wanted.add(a.hash);
            } catch { /* a damaged record keeps nothing */ }
          }
        }
      }
    };
    await walk(dir.current);
    await walk(dir.history);
    let removed = 0;
    let files = [];
    try {
      files = await readdir(dir.assets);
    } catch { /* no assets yet */ }
    for (const f of files) {
      const hash = f.endsWith('.json') ? f.slice(0, -5) : f;
      if (!isAssetHash(hash) || wanted.has(hash)) continue;
      const st = await stat(path.join(dir.assets, f)).catch(() => null);
      if (st && Date.now() - st.mtimeMs >= c.gcMinAgeMs) {
        await rm(path.join(dir.assets, f), { force: true });
        if (!f.endsWith('.json')) removed += 1;
      }
    }
    return removed;
  }

  async function status(req, res) {
    requireAdmin(req);
    const updates = [];
    const walk = async (base, parts) => {
      let names = [];
      try {
        names = await readdir(base, { withFileTypes: true });
      } catch {
        return;
      }
      for (const n of names) {
        if (n.isDirectory()) await walk(path.join(base, n.name), [...parts, n.name]);
        else if (n.name.endsWith('.json') && parts.length === 3) {
          const rec = await readJsonFile(path.join(base, n.name));
          updates.push({ channel: parts[0], runtimeVersion: parts[1], nativeHash: parts[2], platform: n.name.slice(0, -5), kind: rec.kind, id: rec.id, createdAt: rec.createdAt, signed: Boolean(rec.signature) });
        }
      }
    };
    await walk(dir.current, []);
    let assets = 0;
    let bytes = 0;
    for (const f of await readdir(dir.assets).catch(() => [])) {
      if (f.endsWith('.json')) continue;
      assets += 1;
      bytes += (await stat(path.join(dir.assets, f)).catch(() => ({ size: 0 }))).size;
    }
    const requests = [...seen.entries()].map(([k, v]) => {
      const [channel, runtimeVersion, nativeHash, platform] = k.split('|');
      return { channel, runtimeVersion, nativeHash, platform, ...v };
    });
    json(res, 200, { updates, assets, bytes, signatureCheck: Boolean(cert), requests });
  }

  /* ------------------------------------------------------------ routing ------------------------------------------------------------ */
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const seg = url.pathname.split('/').filter(Boolean);
    if (seg[0] !== 'ota') throw new HttpError(404, 'not found');
    if (seg.length === 2 && seg[1] === 'health') return json(res, 200, { ok: true });
    if (seg[1] === 'assets' && seg.length === 3) return asset(req, res, seg[2]);
    if (seg[1] === 'admin') {
      if (seg.length === 3 && seg[2] === 'status' && req.method === 'GET') return status(req, res);
      if (seg.length === 3 && seg[2] === 'publish' && req.method === 'POST') return publish(req, res);
      if (seg.length === 4 && seg[2] === 'assets' && seg[3] === 'missing' && req.method === 'POST') return missingAssets(req, res);
      if (seg.length === 4 && seg[2] === 'assets' && req.method === 'PUT') return putAsset(req, res, seg[3]);
      throw new HttpError(404, 'not found');
    }
    if (seg.length === 3 && seg[2] === 'manifest' && isChannel(seg[1])) return manifest(req, res, seg[1]);
    throw new HttpError(404, 'not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) {
        if (e.status === 401) c.log(`401 ${req.method} ${req.url}`);
        return json(res, e.status, { error: e.message });
      }
      c.log(`500 ${req.method} ${req.url} ${e?.stack ?? e}`);
      json(res, 500, { error: 'internal error' });
    });
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 20_000;

  return {
    server,
    listen: (port = 0, host = '127.0.0.1') => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/* ------------------------------------------------------------ run as a program ------------------------------------------------------------ */
async function main() {
  const env = process.env;
  const certPath = env.OTA_CERT;
  const app = createOtaServer({
    dataDir: env.OTA_DATA ?? './data',
    publicBase: env.OTA_PUBLIC_BASE ?? '',
    adminToken: env.OTA_ADMIN_TOKEN ?? '',
    certPem: certPath && existsSync(certPath) ? readFileSync(certPath, 'utf8') : null,
    keep: Number(env.OTA_KEEP ?? 10),
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
  const port = await app.listen(Number(env.OTA_PORT ?? 8789), env.OTA_HOST ?? '127.0.0.1');
  console.log(`OTA server listening on ${env.OTA_HOST ?? '127.0.0.1'}:${port}  public=${env.OTA_PUBLIC_BASE}  signature-check=${certPath && existsSync(certPath) ? 'on' : 'OFF (no certificate)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`起動できませんでした: ${e.message}`);
    process.exit(1);
  });
}
