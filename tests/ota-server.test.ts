import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { boundaryOf, parseMultipart, parseSignatureHeader, sha256b64u, verifyRsaSha256 } from '../ota/lib.mjs';
import { buildRollback, buildUpdate, send } from '../ota/publish.mjs';
import { createOtaServer } from '../ota/server.mjs';

const TOKEN = 'test-token-0123456789abcdef';
const HASH = '0123456789abcdef';
const NATIVE = HASH;

function tmp(prefix: string) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** a test certificate + key, made with OpenSSL (the real ones come from Expo's generator) */
function makeKeys() {
  const dir = tmp('keys-');
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '30', '-subj', '/CN=Test', '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=critical,codeSigning'], { stdio: 'ignore' });
  return { privateKeyPem: readFileSync(key, 'utf8'), certPem: readFileSync(crt, 'utf8') };
}

/** what `expo export` leaves in dist/ – bundles per platform, one image shared by both, a font only on iOS */
function makeDist(tag = 'v1') {
  const dist = tmp('dist-');
  const w = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    writeFileSync(path.join(dist, rel), content);
  };
  w('_expo/static/js/ios/index-ios.hbc', `IOS BUNDLE ${tag}`);
  w('_expo/static/js/android/index-android.hbc', `ANDROID BUNDLE ${tag}`);
  w('assets/img-shared', 'SHARED IMAGE');
  w('assets/font-ios', 'FONT');
  w('assets/only-this-version', `PICTURE ${tag}`);
  writeFileSync(
    path.join(dist, 'metadata.json'),
    JSON.stringify({
      version: 0,
      bundler: 'metro',
      fileMetadata: {
        ios: { bundle: '_expo/static/js/ios/index-ios.hbc', assets: [{ path: 'assets/img-shared', ext: 'png' }, { path: 'assets/font-ios', ext: 'ttf' }, { path: 'assets/only-this-version', ext: 'png' }] },
        android: { bundle: '_expo/static/js/android/index-android.hbc', assets: [{ path: 'assets/img-shared', ext: 'png' }, { path: 'assets/only-this-version', ext: 'png' }] },
      },
    }),
  );
  return dist;
}

interface Reply {
  status: number;
  headers: Headers;
  parts: { name: string; headers: Record<string, string>; body: string }[];
  text: string;
}

/** requests like the expo-updates client does */
async function ask(base: string, o: { channel?: string; platform?: string | null; runtime?: string | null; hash?: string | null; headers?: Record<string, string>; expectSignature?: boolean } = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    'expo-protocol-version': '1',
    accept: 'multipart/mixed,application/expo+json,application/json',
    ...(o.platform === null ? {} : { 'expo-platform': o.platform ?? 'ios' }),
    ...(o.runtime === null ? {} : { 'expo-runtime-version': o.runtime ?? '1' }),
    ...(o.hash === null ? {} : { 'x-native-hash': o.hash ?? NATIVE }),
    ...(o.expectSignature === false ? {} : { 'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"' }),
    ...(o.headers ?? {}),
  };
  const r = await fetch(`${base}/ota/${o.channel ?? 'trial'}/manifest`, { headers });
  const text = await r.text();
  const b = boundaryOf(r.headers.get('content-type') ?? '');
  return { status: r.status, headers: r.headers, parts: b ? parseMultipart(Buffer.from(text), b) : [], text };
}

describe('the update server (with signatures checked)', () => {
  let base = '';
  let app: ReturnType<typeof createOtaServer>;
  let data = '';
  const keys = makeKeys();
  const wrongKeys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const logs: string[] = [];
  const server = () => `http://127.0.0.1:${base.split(':').pop()}`;
  const publishUpdate = async (tag = 'v1', extra: Record<string, unknown> = {}, now = new Date()) => {
    const built = buildUpdate({ distDir: makeDist(tag), channel: 'trial', runtimeVersion: '1', nativeHash: NATIVE, baseUrl: base, privateKeyPem: keys.privateKeyPem, expoClient: { name: 'Music space' }, now, ...extra });
    const result = await send({ server: base, token: TOKEN, publish: built.publish, files: built.files });
    return { built, result };
  };

  before(async () => {
    data = tmp('ota-data-');
    app = createOtaServer({ dataDir: data, publicBase: 'http://placeholder', adminToken: TOKEN, certPem: keys.certPem, keep: 2, gcMinAgeMs: 0, log: (l: string) => logs.push(l) });
    const port = await app.listen(0);
    base = `http://127.0.0.1:${port}`;
    // the public address must be the real one, because the manifests carry it: restart with it
    await app.close();
    app = createOtaServer({ dataDir: data, publicBase: base, adminToken: TOKEN, certPem: keys.certPem, keep: 2, gcMinAgeMs: 0, log: (l: string) => logs.push(l) });
    await app.listen(port);
  });
  after(async () => app.close());

  it('answers /health, and nothing else exists (404), nothing to write with GET', async () => {
    assert.equal((await fetch(`${base}/ota/health`)).status, 200);
    for (const p of ['/', '/ota', '/ota/nope', '/other/health', '/ota/trial/other', '/ota/Trial/manifest', '/ota/admin']) assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    assert.equal((await fetch(`${base}/ota/trial/manifest`, { method: 'POST' })).status, 405);
  });

  it('nothing published yet: 204, with the protocol headers, for every question', async () => {
    const r = await ask(base);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('expo-protocol-version'), '1');
    assert.equal(r.headers.get('expo-sfv-version'), '0');
    assert.equal(r.headers.get('cache-control'), 'private, max-age=0');
    assert.equal(r.text, '');
  });

  it('the admin side needs the token – every door', async () => {
    const doors: [string, string][] = [['POST', '/ota/admin/assets/missing'], ['PUT', `/ota/admin/assets/${sha256b64u(Buffer.from('x'))}`], ['POST', '/ota/admin/publish'], ['GET', '/ota/admin/status']];
    for (const [method, p] of doors) {
      assert.equal((await fetch(`${base}${p}`, { method })).status, 401, `${method} ${p} without a token`);
      assert.equal((await fetch(`${base}${p}`, { method, headers: { authorization: 'Bearer wrong-token-0123456789' } })).status, 401, `${method} ${p} wrong token`);
      assert.equal((await fetch(`${base}${p}`, { method, headers: { authorization: TOKEN } })).status, 401, `${method} ${p} no "Bearer"`);
    }
  });

  it('publish → an app asks → gets exactly the signed manifest, and every asset checks out', async () => {
    const { built, result } = await publishUpdate('v1');
    assert.equal(result.ok, true);
    const iosBody = built.publish.platforms.ios.body as string;

    const r = await ask(base, { platform: 'ios' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /^multipart\/mixed; boundary=/);
    assert.equal(r.headers.get('expo-protocol-version'), '1');
    assert.equal(r.headers.get('expo-sfv-version'), '0');
    assert.equal(r.headers.get('cache-control'), 'private, max-age=0');
    assert.deepEqual(r.parts.map((p) => p.name), ['manifest', 'extensions']);

    const [m, ext] = r.parts;
    assert.equal(m.body, iosBody, 'the text that was signed is the text that is sent, byte for byte');
    assert.match(m.headers['content-disposition'], /form-data; name="manifest"/);
    assert.match(m.headers['content-type'], /^application\/json/);
    assert.deepEqual(JSON.parse(ext.body), { assetRequestHeaders: {} });

    // what the app does with the signature: verify it with the certificate that is built into it
    const sig = parseSignatureHeader(m.headers['expo-signature']);
    assert.ok(sig && sig.keyid === 'main');
    assert.ok(verifyRsaSha256(m.body, sig.sig, new X509Certificate(keys.certPem).publicKey), 'signature verifies against the certificate');

    // … and with each asset
    const manifest = JSON.parse(m.body);
    assert.equal(manifest.runtimeVersion, '1');
    assert.deepEqual(manifest.extra, { expoClient: { name: 'Music space' } });
    for (const a of [manifest.launchAsset, ...manifest.assets]) {
      assert.ok(a.url.startsWith(`${base}/ota/assets/`));
      const res = await fetch(a.url);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), a.contentType);
      assert.match(res.headers.get('cache-control') ?? '', /immutable/);
      assert.equal(sha256b64u(Buffer.from(await res.arrayBuffer())), a.hash, 'the app verifies this hash');
      const again = await fetch(a.url, { headers: { 'if-none-match': `"${a.hash}"` } });
      assert.equal(again.status, 304);
    }
    assert.equal((await fetch(manifest.launchAsset.url, { method: 'HEAD' })).status, 200);
  });

  it('each platform gets its own bundle, from the same update', async () => {
    const ios = JSON.parse((await ask(base, { platform: 'ios' })).parts[0].body);
    const android = JSON.parse((await ask(base, { platform: 'android' })).parts[0].body);
    assert.equal(ios.id, android.id);
    assert.equal(ios.createdAt, android.createdAt);
    assert.notEqual(ios.launchAsset.hash, android.launchAsset.hash);
    assert.equal(ios.assets.length, 3);
    assert.equal(android.assets.length, 2);
  });

  it('an app whose runtime, native fingerprint or channel differs gets nothing – never a wrong update', async () => {
    assert.equal((await ask(base, { runtime: '2' })).status, 204);
    assert.equal((await ask(base, { hash: 'fedcba9876543210' })).status, 204);
    assert.equal((await ask(base, { channel: 'main' })).status, 204);
    assert.equal((await ask(base, { platform: 'android', hash: 'fedcba9876543210' })).status, 204);
  });

  it('bad questions are answered with a reason, not a crash', async () => {
    assert.equal((await ask(base, { platform: null })).status, 400);
    assert.equal((await ask(base, { platform: 'web' })).status, 400);
    assert.equal((await ask(base, { runtime: null })).status, 400);
    assert.equal((await ask(base, { runtime: '../etc' })).status, 400);
    assert.equal((await ask(base, { hash: null })).status, 400);
    assert.equal((await ask(base, { hash: '../../x' })).status, 400);
    assert.equal((await ask(base, { hash: 'ABCDEF0123456789' })).status, 400);
  });

  it('an old app (protocol 0) and a JSON-only client are served too; other formats are refused', async () => {
    const old = await ask(base, { headers: { 'expo-protocol-version': '0' } });
    assert.equal(old.status, 200);
    assert.equal(old.headers.get('expo-protocol-version'), '0');
    const j = await ask(base, { headers: { accept: 'application/expo+json' } });
    assert.equal(j.status, 200);
    assert.equal(j.headers.get('content-type'), 'application/expo+json');
    assert.equal(JSON.parse(j.text).launchAsset.contentType, 'application/javascript');
    assert.ok(parseSignatureHeader(j.headers.get('expo-signature') ?? ''), 'the signature goes in the header');
    assert.equal((await ask(base, { headers: { accept: 'text/html' } })).status, 406);
  });

  it('without a request for a signature, none is sent (the app does not check)', async () => {
    const r = await ask(base, { expectSignature: false });
    assert.equal(r.status, 200);
    assert.equal(r.parts[0].headers['expo-signature'], undefined);
  });

  it('an upload whose content does not match its hash is refused and nothing is kept', async () => {
    const hash = sha256b64u(Buffer.from('the real content'));
    const bad = await fetch(`${base}/ota/admin/assets/${hash}`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'x-asset-content-type': 'image/png' }, body: Buffer.from('something else') });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/ota/assets/${hash}`)).status, 404);
    const miss = await fetch(`${base}/ota/admin/assets/missing`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ hashes: [hash] }) });
    assert.deepEqual((await miss.json()).missing, [hash]);
    const good = await fetch(`${base}/ota/admin/assets/${hash}`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'x-asset-content-type': 'image/png' }, body: Buffer.from('the real content') });
    assert.equal(good.status, 201);
    assert.equal((await fetch(`${base}/ota/assets/${hash}`)).status, 200);
  });

  it('uploads: a bad content type, a bad hash and path tricks are refused', async () => {
    const hash = sha256b64u(Buffer.from('y'));
    const put = (h: string, type: string) => fetch(`${base}/ota/admin/assets/${h}`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'x-asset-content-type': type }, body: Buffer.from('y') });
    assert.equal((await put(hash, 'not a mime')).status, 400);
    assert.equal((await put(hash, 'image/png; x=1')).status, 400, 'parameters are not allowed in the type');
    assert.equal((await put(hash, 'image/PNG '.repeat(30))).status, 400, 'too long');
    assert.equal((await put('short', 'image/png')).status, 400);
    assert.equal((await put('..%2F..%2Fetc%2Fpasswd', 'image/png')).status, 400);
    assert.equal((await fetch(`${base}/ota/assets/..%2F..%2Fetc%2Fpasswd`)).status, 404);
    assert.equal((await fetch(`${base}/ota/assets/${'A'.repeat(43)}`)).status, 404);
  });

  it('publishing is checked: wrong addresses, missing files, mixed-up ids, wrong signature, unsigned', async () => {
    const mk = () => buildUpdate({ distDir: makeDist('check'), channel: 'trial', runtimeVersion: '1', nativeHash: NATIVE, baseUrl: base, privateKeyPem: keys.privateKeyPem, now: new Date(Date.now() + 60_000) });
    const post = (p: unknown) => fetch(`${base}/ota/admin/publish`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(p) });
    const withBody = (b: ReturnType<typeof mk>, platform: 'ios' | 'android', change: (m: any) => void, resign = true) => {
      const m = JSON.parse(b.publish.platforms[platform].body);
      change(m);
      const body = JSON.stringify(m);
      b.publish.platforms[platform] = { body, signature: resign ? buildUpdate && signWith(body, keys.privateKeyPem) : null } as never;
      return b.publish;
    };
    const { signRsaSha256, signatureHeader } = await import('../ota/lib.mjs');
    const signWith = (body: string, key: string) => signatureHeader(signRsaSha256(body, key), 'main');

    // assets were not uploaded (we skip the upload on purpose)
    assert.equal((await post(mk().publish)).status, 422, 'files not stored yet');

    const b1 = mk();
    await send({ server: base, token: TOKEN, publish: { ...b1.publish, platforms: {} } as never, files: b1.files }).catch(() => undefined); // uploads the assets, then fails on "platforms"
    assert.equal((await post(b1.publish)).status, 200, 'now it works');

    const b2 = mk();
    await send({ server: base, token: TOKEN, publish: { ...b2.publish, platforms: {} } as never, files: b2.files }).catch(() => undefined);
    const elsewhere = withBody(b2, 'ios', (m) => { m.launchAsset.url = 'https://evil.example/ota/assets/x'; });
    assert.equal((await post(elsewhere)).status, 422, 'an asset address that is not this server');

    const b3 = mk();
    await send({ server: base, token: TOKEN, publish: { ...b3.publish, platforms: {} } as never, files: b3.files }).catch(() => undefined);
    assert.equal((await post(withBody(b3, 'ios', (m) => { m.id = '123e4567-e89b-12d3-a456-426614174000'; }))).status, 422, 'id differs from the update');

    const b4 = mk();
    await send({ server: base, token: TOKEN, publish: { ...b4.publish, platforms: {} } as never, files: b4.files }).catch(() => undefined);
    const wrongSig = JSON.parse(JSON.stringify(b4.publish));
    wrongSig.platforms.ios.signature = signWith(wrongSig.platforms.ios.body, wrongKeys.privateKey);
    assert.equal((await post(wrongSig)).status, 422, 'signed with another key than the certificate');
    const unsigned = JSON.parse(JSON.stringify(b4.publish));
    unsigned.platforms.ios.signature = null;
    assert.equal((await post(unsigned)).status, 422, 'a certificate is configured: unsigned updates are refused');
    const tampered = JSON.parse(JSON.stringify(b4.publish));
    tampered.platforms.ios.body = tampered.platforms.ios.body.replace('"metadata":{}', '"metadata":{"x":"1"}');
    assert.equal((await post(tampered)).status, 422, 'text changed after signing');

    for (const [change, why] of [
      [(p: any) => (p.channel = '../x'), 'channel'],
      [(p: any) => (p.runtimeVersion = 'a/b'), 'runtime'],
      [(p: any) => (p.nativeHash = 'XYZ'), 'native hash'],
      [(p: any) => (p.kind = 'other'), 'kind'],
      [(p: any) => (p.createdAt = 'yesterday'), 'date'],
      [(p: any) => (p.id = 'nope'), 'id'],
      [(p: any) => (p.platforms = { web: p.platforms.ios }), 'platform'],
      [(p: any) => (p.platforms = {}), 'no platform'],
    ] as const) {
      const bad = JSON.parse(JSON.stringify(b4.publish));
      change(bad);
      assert.equal((await post(bad)).status, 400, why);
    }
    assert.equal((await fetch(`${base}/ota/admin/publish`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: 'not json' })).status, 400);
  });

  it('a newer update replaces the older one; an older date is refused (the app only takes newer ones)', async () => {
    const before = JSON.parse((await ask(base)).parts[0].body);
    const { built } = await publishUpdate('v-newer', {}, new Date(Date.parse(before.createdAt) + 600_000));
    const after = JSON.parse((await ask(base)).parts[0].body);
    assert.equal(after.id, built.publish.id);
    assert.ok(Date.parse(after.createdAt) > Date.parse(before.createdAt));
    const old = buildUpdate({ distDir: makeDist('v-older'), channel: 'trial', runtimeVersion: '1', nativeHash: NATIVE, baseUrl: base, privateKeyPem: keys.privateKeyPem, now: new Date(Date.parse(before.createdAt) - 60_000) });
    await assert.rejects(() => send({ server: base, token: TOKEN, publish: old.publish, files: old.files }), /409/);
    assert.equal(JSON.parse((await ask(base)).parts[0].body).id, built.publish.id, 'unchanged');
  });

  it('old updates are kept only a while, and files nobody points at are removed', async () => {
    const t0 = Date.now() + 3_600_000;
    const ids: string[] = [];
    const firstAssets: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { built } = await publishUpdate(`gc-${i}`, {}, new Date(t0 + i * 60_000));
      ids.push(built.publish.id);
      if (i === 0) firstAssets.push(...[...built.files.entries()].filter(([, f]) => f.buffer.toString().includes('gc-0')).map(([h]) => h));
    }
    assert.ok(firstAssets.length > 0);
    for (const h of firstAssets) assert.equal((await fetch(`${base}/ota/assets/${h}`)).status, 404, 'files only the first of four updates used (keep=2) are gone');
    assert.equal(JSON.parse((await ask(base)).parts[0].body).id, ids[3]);
    const status = await (await fetch(`${base}/ota/admin/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    assert.ok(status.assets > 0 && status.signatureCheck === true);
  });

  it('rollback: apps on an updated version get the signed instruction to go back to the one inside the app', async () => {
    await publishUpdate('before-rollback', {}, new Date(Date.now() + 7_200_000));
    const rb = buildRollback({ channel: 'trial', runtimeVersion: '1', nativeHash: NATIVE, privateKeyPem: keys.privateKeyPem, now: new Date(Date.now() + 7_300_000) });
    await send({ server: base, token: TOKEN, publish: rb.publish, files: rb.files });

    const r = await ask(base, { headers: { 'expo-current-update-id': '123e4567-e89b-12d3-a456-426614174000', 'expo-embedded-update-id': 'aaaaaaaa-e89b-12d3-a456-426614174000' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.parts.map((p) => p.name), ['directive']);
    const directive = JSON.parse(r.parts[0].body);
    assert.equal(directive.type, 'rollBackToEmbedded');
    assert.ok(Date.parse(directive.parameters.commitTime) > Date.now(), 'commit time is what the app compares with its own update');
    const sig = parseSignatureHeader(r.parts[0].headers['expo-signature']);
    assert.ok(sig && verifyRsaSha256(r.parts[0].body, sig.sig, new X509Certificate(keys.certPem).publicKey));

    const already = await ask(base, { headers: { 'expo-current-update-id': 'aaaaaaaa-e89b-12d3-a456-426614174000', 'expo-embedded-update-id': 'aaaaaaaa-e89b-12d3-a456-426614174000' } });
    assert.equal(already.status, 204, 'already running the embedded version: nothing to do');
    assert.equal((await ask(base, { headers: { 'expo-protocol-version': '0' } })).status, 204, 'protocol 0 cannot roll back');
    assert.equal((await ask(base, { headers: { accept: 'application/json' } })).status, 406, 'JSON-only clients cannot receive a directive');

    // a later update takes over again
    const { built } = await publishUpdate('after-rollback', {}, new Date(Date.now() + 7_400_000));
    assert.equal(JSON.parse((await ask(base)).parts[0].body).id, built.publish.id);
  });

  it('a restart loses nothing', async () => {
    const before = await ask(base);
    const port = Number(base.split(':').pop());
    await app.close();
    app = createOtaServer({ dataDir: data, publicBase: base, adminToken: TOKEN, certPem: keys.certPem, keep: 2, gcMinAgeMs: 0 });
    await app.listen(port);
    // the first request after a restart may find its old connection gone (any HTTP client retries once)
    const after = await ask(base).catch(() => ask(base));
    assert.equal(after.parts[0].body, before.parts[0].body);
  });

  it('the status shows what is published and which builds are asking', async () => {
    await ask(base, { hash: 'fedcba9876543210' }); // (the counts live in memory: they start again after a restart)
    const status = await (await fetch(`${base}/ota/admin/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    const ios = status.updates.find((u: { platform: string }) => u.platform === 'ios');
    assert.ok(ios && ios.channel === 'trial' && ios.nativeHash === NATIVE && ios.signed === true);
    assert.ok(status.requests.some((r: { nativeHash: string; count: number }) => r.nativeHash === 'fedcba9876543210' && r.count >= 1), 'builds whose fingerprint never got an update are visible');
  });
});

describe('the server without a certificate (a trial before signing is set up)', () => {
  it('stores updates unsigned and refuses an app that insists on a signature', async () => {
    const data = tmp('ota-nocert-');
    let app = createOtaServer({ dataDir: data, publicBase: 'http://placeholder', adminToken: TOKEN });
    const port = await app.listen(0);
    await app.close();
    const base = `http://127.0.0.1:${port}`;
    app = createOtaServer({ dataDir: data, publicBase: base, adminToken: TOKEN });
    await app.listen(port);
    const built = buildUpdate({ distDir: makeDist(), channel: 'trial', runtimeVersion: '1', nativeHash: NATIVE, baseUrl: base, privateKeyPem: null });
    await send({ server: base, token: TOKEN, publish: built.publish, files: built.files });
    assert.equal((await ask(base, { expectSignature: false })).status, 200);
    const r = await ask(base);
    assert.equal(r.status, 400);
    assert.match(r.text, /署名/);
    await app.close();
  });

  it('refuses to start with a weak token or without the basics', () => {
    assert.throws(() => createOtaServer({ dataDir: tmp('x-'), publicBase: 'http://h', adminToken: 'short' }), /adminToken/);
    assert.throws(() => createOtaServer({ dataDir: '', publicBase: 'http://h', adminToken: TOKEN }), /dataDir/);
  });
});

describe('running as the program the container starts', () => {
  it('starts from environment settings, says what it does, and answers', async () => {
    const { spawn } = await import('node:child_process');
    const data = tmp('ota-run-');
    const env = { ...process.env, OTA_DATA: data, OTA_PUBLIC_BASE: 'http://127.0.0.1', OTA_ADMIN_TOKEN: TOKEN, OTA_PORT: '0', OTA_HOST: '127.0.0.1', OTA_CERT: '/nonexistent/certificate.pem' };
    const child = spawn(process.execPath, ['ota/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const line: string = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('did not start')), 8000);
        child.stdout.on('data', (d) => {
          const m = /listening on 127\.0\.0\.1:(\d+)/.exec(String(d));
          if (m) {
            clearTimeout(t);
            resolve(String(d));
          }
        });
        child.on('exit', (c) => reject(new Error(`exited ${c}`)));
      });
      assert.match(line, /signature-check=OFF/, 'it says clearly that no certificate is configured');
      const port = /:(\d+)/.exec(line)![1];
      const r = await fetch(`http://127.0.0.1:${port}/ota/health`);
      assert.deepEqual(await r.json(), { ok: true });
    } finally {
      child.kill();
    }
  });

  it('does not start without a proper token, and says why', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['ota/server.mjs'], { env: { ...process.env, OTA_ADMIN_TOKEN: '', OTA_DATA: tmp('x-'), OTA_PUBLIC_BASE: 'http://h' }, encoding: 'utf8', timeout: 8000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /adminToken/);
  });
});

describe('the files that are put on the server', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');

  it('the container: local only, small memory, read-only, no extra rights, no secret inside', () => {
    const c = readFileSync('ota/deploy/musicspace-ota.container', 'utf8');
    assert.match(c, /PublishPort=127\.0\.0\.1:8789:8789/, 'not reachable from outside except through Caddy');
    assert.match(c, /--memory=160m/);
    assert.match(c, /--max-old-space-size=48/);
    for (const flag of ['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges']) assert.ok(c.includes(flag), flag);
    assert.match(c, /Restart=always/);
    assert.ok(c.includes('__BASE__') && !/OTA_ADMIN_TOKEN=/.test(c), 'the token lives only in ota.env');
    assert.match(c, /Volume=__BASE__\/app:\/app:ro/, 'the program itself is read-only for the container');
  });

  it('the scripts are valid shell, stop on errors, and keep the secrets private', () => {
    for (const f of ['setup.sh', 'make-keys.sh']) {
      const p = `ota/deploy/${f}`;
      assert.equal(spawnSync('sh', ['-n', p]).status, 0, `${f} syntax`);
      assert.match(readFileSync(p, 'utf8'), /^set -eu$/m, `${f} stops at the first error`);
    }
    const setup = readFileSync('ota/deploy/setup.sh', 'utf8');
    assert.match(setup, /umask 077/, 'ota.env (with the token) is readable only by you');
    assert.match(setup, /openssl rand -hex 32/);
    const keys = readFileSync('ota/deploy/make-keys.sh', 'utf8');
    assert.match(keys, /chmod 600 private-key\.pem/);
    assert.match(keys, /rm \$BASE\/keys\/private-key\.pem/, 'tells you to remove the private key from the server');
    assert.match(keys, /exit 1/, 'never overwrites existing keys');
    assert.match(keys, /podman run --rm --memory=400m/, 'the key tool cannot use all the memory of a small machine');
  });

  it('the Caddy snippet sends only /ota/ to the server', () => {
    const s = readFileSync('ota/deploy/Caddyfile.snippet', 'utf8');
    assert.match(s, /handle \/ota\/\*/);
    assert.match(s, /reverse_proxy 127\.0\.0\.1:8789/);
  });

  it('the guide mentions every step and every secret by name', () => {
    const g = readFileSync('ota/README.md', 'utf8');
    for (const word of ['OTA_ADMIN_TOKEN', 'OTA_PRIVATE_KEY', 'ota/certificate.pem', 'sh setup.sh', 'sh make-keys.sh', 'variant: trial', 'channel: trial', 'enabledFor', 'Roll back']) assert.ok(g.includes(word), word);
  });
});
