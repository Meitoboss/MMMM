import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { applyOtaToApp, channelOf } from '../scripts/apply-ota.mjs';
import { isUuid, parseSignatureHeader, verifyRsaSha256 } from '../ota/lib.mjs';
import { computeNativeHash, listNativePackages, normalizedConfig } from '../ota/native-hash.mjs';
import { cleanReleaseNote } from '../ota/lib.mjs';
import { buildRollback, buildUpdate, describeNetworkError, send } from '../ota/publish.mjs';
import { cleanNote } from '../src/core/updater';

const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), p));
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

function dist(opts: { traverse?: boolean; noAndroid?: boolean } = {}) {
  const d = tmp('dist-');
  const w = (rel: string, c: string) => {
    mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    writeFileSync(path.join(d, rel), c);
  };
  w('b-ios.hbc', 'IOS');
  w('b-android.hbc', 'ANDROID');
  w('assets/shared', 'SHARED');
  w('assets/ios-only', 'IOSONLY');
  writeFileSync(
    path.join(d, 'metadata.json'),
    JSON.stringify({
      fileMetadata: {
        ios: { bundle: 'b-ios.hbc', assets: [{ path: 'assets/shared', ext: 'png' }, { path: 'assets/ios-only', ext: 'ttf' }, ...(opts.traverse ? [{ path: '../../../etc/hostname', ext: 'txt' }] : [])] },
        ...(opts.noAndroid ? {} : { android: { bundle: 'b-android.hbc', assets: [{ path: 'assets/shared', ext: 'png' }] } }),
      },
    }),
  );
  return d;
}

describe('building an update from the files `expo export` made', () => {
  const base = { channel: 'trial', runtimeVersion: '1', nativeHash: '0123456789abcdef', baseUrl: 'https://example.com' };

  it('signs the exact text of each platform\'s manifest; files shared by the platforms are one file', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    const { publish, files } = buildUpdate({ ...base, distDir: dist(), privateKeyPem: rsa.privateKey, now });
    assert.ok(isUuid(publish.id));
    assert.equal(publish.createdAt, '2026-10-08T12:00:00.000Z');
    assert.equal(publish.kind, 'update');
    assert.deepEqual(Object.keys(publish.platforms).sort(), ['android', 'ios']);
    for (const p of ['ios', 'android'] as const) {
      const { body, signature } = publish.platforms[p];
      const sig = parseSignatureHeader(signature);
      assert.ok(sig && sig.keyid === 'main');
      assert.ok(verifyRsaSha256(body, sig.sig, rsa.publicKey), `${p} signature`);
      assert.equal(JSON.parse(body).id, publish.id);
      assert.equal(JSON.parse(body).createdAt, publish.createdAt);
    }
    assert.equal(files.size, 4, '2 bundles + the shared image + the iOS-only font: the shared one is a single file');
  });

  it('without a key the update is not signed (a server with a certificate refuses it)', () => {
    const { publish } = buildUpdate({ ...base, distDir: dist(), privateKeyPem: null });
    assert.equal(publish.platforms.ios.signature, null);
  });

  it('only the platforms asked for', () => {
    const { publish } = buildUpdate({ ...base, distDir: dist(), privateKeyPem: null, platforms: ['ios'] });
    assert.deepEqual(Object.keys(publish.platforms), ['ios']);
  });

  it('a platform that was not exported is reported in words', () => {
    assert.throws(() => buildUpdate({ ...base, distDir: dist({ noAndroid: true }), privateKeyPem: null }), /android の書き出しがありません/);
  });

  it('a metadata.json that points outside the folder is refused', () => {
    assert.throws(() => buildUpdate({ ...base, distDir: dist({ traverse: true }), privateKeyPem: null }), /外のファイル/);
  });

  it('not an `expo export` folder', () => {
    const d = tmp('empty-');
    writeFileSync(path.join(d, 'metadata.json'), '{}');
    assert.throws(() => buildUpdate({ ...base, distDir: d, privateKeyPem: null }), /fileMetadata/);
    assert.throws(() => buildUpdate({ ...base, distDir: tmp('nothing-'), privateKeyPem: null }));
  });

  it('a rollback is a signed instruction; its commit time is its creation time', () => {
    const { publish, files } = buildRollback({ channel: 'trial', runtimeVersion: '1', nativeHash: '0123456789abcdef', privateKeyPem: rsa.privateKey, now: new Date('2026-10-08T13:00:00.000Z') });
    assert.equal(files.size, 0);
    assert.equal(publish.kind, 'rollback');
    const d = JSON.parse(publish.platforms.ios.body);
    assert.deepEqual(d, { type: 'rollBackToEmbedded', parameters: { commitTime: '2026-10-08T13:00:00.000Z' } });
    assert.ok(verifyRsaSha256(publish.platforms.ios.body, parseSignatureHeader(publish.platforms.ios.signature)!.sig, rsa.publicKey));
  });
});

describe('sending', () => {
  const built = () => buildUpdate({ channel: 'trial', runtimeVersion: '1', nativeHash: '0123456789abcdef', baseUrl: 'https://example.com', distDir: dist(), privateKeyPem: null });
  const NOW = [0, 0, 0]; // no waiting in tests

  /** a server that answers; `failOn` / `failMethod` make one door answer 500; `drop(n)` makes the first n requests fail like a dead network */
  function fakeServer(missingCount: number, failOn?: string, failMethod?: string, drop = 0, dropWith: () => Error = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' }) })) {
    const calls: string[] = [];
    let dropped = 0;
    const impl = async (url: string, init: RequestInit) => {
      const u = new URL(url);
      calls.push(`${init.method} ${u.pathname.replace(/\/[A-Za-z0-9_-]{43}$/, '/<hash>')}`);
      if (dropped < drop) {
        dropped++;
        throw dropWith();
      }
      const json = (s: number, o: unknown) => new Response(JSON.stringify(o), { status: s });
      if (failOn && u.pathname.includes(failOn) && (!failMethod || init.method === failMethod)) return json(500, { error: 'boom' });
      if (u.pathname.endsWith('/health')) return json(200, { ok: true });
      if (u.pathname.endsWith('/missing')) {
        const hashes = JSON.parse(String(init.body)).hashes as string[];
        return json(200, { missing: hashes.slice(0, missingCount) });
      }
      if (u.pathname.endsWith('/publish')) return json(200, { ok: true });
      return json(201, {});
    };
    return { calls, impl: impl as unknown as typeof fetch };
  }
  const run = (srv: { impl: typeof fetch }, b = built(), logs: string[] = []) => send({ server: 'https://s/', token: 't', publish: b.publish, files: b.files, fetchImpl: srv.impl, log: (l: string) => logs.push(l), retryDelays: NOW });

  it('first asks whether the server is alive; uploads only what it lacks, with the token, then publishes', async () => {
    const srv = fakeServer(2);
    const logs: string[] = [];
    assert.deepEqual(await run(srv, built(), logs), { ok: true });
    assert.deepEqual(srv.calls, ['GET /ota/health', 'POST /ota/admin/assets/missing', 'PUT /ota/admin/assets/<hash>', 'PUT /ota/admin/assets/<hash>', 'POST /ota/admin/publish']);
    assert.ok(logs.some((l) => /4 個のうち.*2 個/.test(l)));
    assert.ok(logs.includes('サーバーは動いています'));
  });

  it('everything already stored: only the questions and the publish', async () => {
    const srv = fakeServer(0);
    await run(srv);
    assert.deepEqual(srv.calls, ['GET /ota/health', 'POST /ota/admin/assets/missing', 'POST /ota/admin/publish']);
  });

  it('a failing step stops everything, with the server\'s reason; nothing is published', async () => {
    const s1 = fakeServer(1, '/assets/', 'PUT');
    await assert.rejects(() => run(s1), /アップロードに失敗.*500.*boom/);
    assert.ok(!s1.calls.some((c) => c.includes('publish')));
    await assert.rejects(() => run(fakeServer(0, '/publish')), /公開できませんでした.*500.*boom/);
    await assert.rejects(() => run(fakeServer(0, '/missing')), /問い合わせ/);
    await assert.rejects(() => run(fakeServer(0, '/health')), /サーバーが正常に答えません/);
  });

  it('a network that fails now and then is tried again (and says so)', async () => {
    const srv = fakeServer(0, undefined, undefined, 2); // the first two requests are lost
    const logs: string[] = [];
    assert.deepEqual(await run(srv, built(), logs), { ok: true });
    assert.equal(srv.calls.filter((c) => c === 'GET /ota/health').length, 3, 'the health check was tried three times');
    assert.ok(logs.some((l) => /接続を断られました.*もう一度試します/.test(l)));
  });

  it('a network that stays down: gives up after the retries, saying WHY and where – and never gets to uploading', async () => {
    const srv = fakeServer(0, undefined, undefined, 99);
    await assert.rejects(
      () => run(srv),
      (e: Error) => {
        assert.match(e.message, /サーバーの確認: s につながりません: 接続を断られました（サーバーか Caddy が止まっているようです）/);
        assert.match(e.message, /ECONNREFUSED/);
        return true;
      },
    );
    assert.equal(srv.calls.length, 4, 'one try and three retries – then it stops');
  });

  it('a busy server (502 / 503) is tried again; a real refusal (401 / 422 / 409) is not', async () => {
    let n = 0;
    const flaky = async (url: string) => {
      if (String(url).endsWith('/health') && n++ < 2) return new Response('bad gateway', { status: 502 });
      return new Response(JSON.stringify({ ok: true, missing: [] }), { status: 200 });
    };
    const logs: string[] = [];
    await send({ server: 'https://s', token: 't', publish: built().publish, files: new Map(), fetchImpl: flaky as unknown as typeof fetch, log: (l: string) => logs.push(l), retryDelays: NOW });
    assert.equal(n, 3);
    assert.ok(logs.some((l) => l.includes('502')));

    for (const status of [401, 409, 422]) {
      let calls = 0;
      const refuse = async (url: string) => {
        if (String(url).endsWith('/publish')) {
          calls++;
          return new Response(JSON.stringify({ error: `no ${status}` }), { status });
        }
        return new Response(JSON.stringify({ ok: true, missing: [] }), { status: 200 });
      };
      await assert.rejects(() => send({ server: 'https://s', token: 't', publish: built().publish, files: new Map(), fetchImpl: refuse as unknown as typeof fetch, retryDelays: NOW }), new RegExp(`公開できませんでした \\(${status}\\) no ${status}`));
      assert.equal(calls, 1, `${status} is not retried`);
    }
  });

  it('a time-out is reported as one', async () => {
    const srv = fakeServer(0, undefined, undefined, 99, () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    await assert.rejects(() => run(srv), /時間切れです（サーバーが応答しません）/);
  });

  it('against a really closed port: the reason Node hides is shown', async () => {
    // a port that was free a moment ago and is closed now
    const { createServer } = await import('node:net');
    const port: number = await new Promise((resolve) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
    });
    const b = built();
    await assert.rejects(
      () => send({ server: `http://127.0.0.1:${port}`, token: 't', publish: b.publish, files: b.files, retryDelays: [0] }),
      (e: Error) => {
        assert.match(e.message, new RegExp(`127\\.0\\.0\\.1:${port} につながりません: 接続を断られました`));
        assert.match(e.message, /ECONNREFUSED/);
        assert.doesNotMatch(e.message, /^fetch failed$/);
        return true;
      },
    );
  });
});

describe('describing a network failure', () => {
  const err = (code: string, message = '') => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message || code), { code }) });
  it('each cause has its own words', () => {
    const url = 'https://130-210-45-154.sslip.io/ota/health';
    assert.match(describeNetworkError(err('ECONNREFUSED'), url), /接続を断られました/);
    assert.match(describeNetworkError(err('ETIMEDOUT'), url), /応答がありません/);
    assert.match(describeNetworkError(err('UND_ERR_CONNECT_TIMEOUT'), url), /応答がありません/);
    assert.match(describeNetworkError(err('ENOTFOUND'), url), /名前の解決/);
    assert.match(describeNetworkError(err('EAI_AGAIN'), url), /名前の解決/);
    assert.match(describeNetworkError(err('ECONNRESET'), url), /途中で切られました/);
    assert.match(describeNetworkError(err('CERT_HAS_EXPIRED'), url), /証明書/);
    assert.match(describeNetworkError(err('DEPTH_ZERO_SELF_SIGNED_CERT'), url), /証明書/);
    assert.match(describeNetworkError(Object.assign(new Error('x'), { name: 'TimeoutError' }), url), /時間切れ/);
    assert.ok(describeNetworkError(err('ECONNREFUSED'), url).startsWith('130-210-45-154.sslip.io につながりません'));
  });
  it('an unknown cause still shows what there is', () => {
    assert.match(describeNetworkError(err('EWEIRD', 'something odd'), 'https://h/x'), /EWEIRD.*something odd/);
    assert.match(describeNetworkError(new Error('plain'), 'https://h/x'), /h につながりません: plain/);
    assert.match(describeNetworkError('just text', 'not an address'), /not an address/);
  });
});

/** a small project: app.json + node_modules with a few packages */
function project(extra: { app?: Record<string, unknown>; pkgs?: Record<string, { version: string; native?: 'ios' | 'android' | 'podspec' | 'module' | false }>; patch?: string } = {}) {
  const root = tmp('proj-');
  const app = { expo: { name: 'Music space', slug: 'music-space', version: '1.0.1', plugins: ['expo-router'], ios: { bundleIdentifier: 'app.musicspace.player', buildNumber: '2', infoPlist: { UIBackgroundModes: ['audio'] } }, android: { package: 'app.musicspace.player', versionCode: 2, permissions: ['WAKE_LOCK'] }, ...(extra.app ?? {}) } };
  writeFileSync(path.join(root, 'app.json'), JSON.stringify(app));
  const pkgs = { expo: { version: '54.0.1', native: false }, react: { version: '19.1.0', native: false }, 'react-native': { version: '0.81.4', native: 'android' }, zustand: { version: '5.0.0', native: false }, 'react-native-track-player': { version: '4.1.1', native: 'ios' }, ...(extra.pkgs ?? {}) } as NonNullable<typeof extra.pkgs>;
  for (const [name, p] of Object.entries(pkgs)) {
    const dir = path.join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: p.version }));
    if (p.native === 'ios') mkdirSync(path.join(dir, 'ios'));
    if (p.native === 'android') mkdirSync(path.join(dir, 'android'));
    if (p.native === 'podspec') writeFileSync(path.join(dir, 'lib.podspec'), '');
    if (p.native === 'module') writeFileSync(path.join(dir, 'expo-module.config.json'), '{}');
  }
  mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
  if (extra.patch !== undefined) {
    mkdirSync(path.join(root, 'scripts'));
    writeFileSync(path.join(root, 'scripts', 'patch-track-player.mjs'), extra.patch);
  }
  return root;
}
const hashOf = (root: string) => computeNativeHash({ root });

describe('the fingerprint of the native part', () => {
  it('is 16 hex characters and the same for the same project', () => {
    const a = project();
    const b = project();
    assert.match(hashOf(a), /^[0-9a-f]{16}$/);
    assert.equal(hashOf(a), hashOf(b));
  });

  it('JavaScript-only packages do not change it; native packages (any kind) do', () => {
    const base = hashOf(project());
    assert.equal(hashOf(project({ pkgs: { 'left-pad': { version: '1.0.0', native: false } } })), base, 'a new JS-only package');
    assert.equal(hashOf(project({ pkgs: { zustand: { version: '5.9.9', native: false } } })), base, 'another version of a JS-only package');
    for (const kind of ['ios', 'android', 'podspec', 'module'] as const) assert.notEqual(hashOf(project({ pkgs: { 'native-thing': { version: '1.0.0', native: kind } } })), base, `new package with ${kind}`);
    assert.notEqual(hashOf(project({ pkgs: { 'react-native-track-player': { version: '4.1.2', native: 'ios' } } })), base, 'a native package in another version');
  });

  it('React, React Native and Expo always count (the JS must fit them)', () => {
    const base = hashOf(project());
    assert.notEqual(hashOf(project({ pkgs: { react: { version: '19.2.0', native: false } } })), base);
    assert.notEqual(hashOf(project({ pkgs: { expo: { version: '54.0.2', native: false } } })), base);
  });

  it('the version label, name, ids, build numbers and the update settings do not change it', () => {
    const base = hashOf(project());
    const app = JSON.parse(readFileSync(path.join(project(), 'app.json'), 'utf8'));
    app.expo.version = '9.9.9';
    app.expo.name = 'Other';
    app.expo.slug = 'other';
    app.expo.ios.bundleIdentifier = 'x.y';
    app.expo.ios.buildNumber = '99';
    app.expo.android.package = 'x.y';
    app.expo.android.versionCode = 99;
    app.expo.updates = { enabled: true, url: 'https://x' };
    app.expo.runtimeVersion = '7';
    app.expo.extra = { anything: 1 };
    const root = project();
    writeFileSync(path.join(root, 'app.json'), JSON.stringify(app));
    assert.equal(hashOf(root), base);
  });

  it('settings that reach the native project do: plugins, permissions, Info.plist, architecture', () => {
    const base = hashOf(project());
    assert.notEqual(hashOf(project({ app: { plugins: ['expo-router', 'expo-sqlite'] } })), base);
    assert.notEqual(hashOf(project({ app: { android: { package: 'app.musicspace.player', versionCode: 2, permissions: ['WAKE_LOCK', 'CAMERA'] } } })), base);
    assert.notEqual(hashOf(project({ app: { ios: { bundleIdentifier: 'app.musicspace.player', buildNumber: '2', infoPlist: { UIBackgroundModes: ['audio', 'fetch'] } } } })), base);
    assert.notEqual(hashOf(project({ app: { newArchEnabled: false } })), base);
  });

  it('the order of keys in app.json does not matter', () => {
    const a = project({ app: { newArchEnabled: false, scheme: 'x' } });
    const b = project({ app: { scheme: 'x', newArchEnabled: false } });
    assert.equal(hashOf(a), hashOf(b));
  });

  it('the script that patches a native package does (it changes native code)', () => {
    assert.notEqual(hashOf(project({ patch: 'v1' })), hashOf(project({ patch: 'v2' })));
    assert.equal(hashOf(project({ patch: 'v1' })), hashOf(project({ patch: 'v1' })));
  });

  it('scoped packages are looked at, hidden folders are not', () => {
    const root = project();
    const before = hashOf(root);
    mkdirSync(path.join(root, 'node_modules', '@scope', 'native', 'ios'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', '@scope', 'native', 'package.json'), JSON.stringify({ name: '@scope/native', version: '1.0.0' }));
    mkdirSync(path.join(root, 'node_modules', '.hidden', 'ios'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', '.hidden', 'package.json'), JSON.stringify({ name: 'hidden', version: '1.0.0' }));
    assert.notEqual(hashOf(root), before);
    assert.deepEqual(listNativePackages(root).filter((p) => p.includes('scope') || p.includes('hidden')), ['@scope/native@1.0.0']);
  });

  it('a project without node_modules still gives a fingerprint', () => {
    const root = tmp('bare-');
    writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: { name: 'x' } }));
    assert.match(hashOf(root), /^[0-9a-f]{16}$/);
    assert.deepEqual(normalizedConfig({ expo: { name: 'x', version: '1', ios: { buildNumber: '1' } } }), { ios: {} });
  });
});

describe('setting up an app for over-the-air updates (scripts/apply-ota.mjs)', () => {
  const app = () => JSON.parse(readFileSync('app.json', 'utf8'));
  const config = { serverBase: 'https://ota.example.com/', runtimeVersion: '1', enabledFor: ['trial'] };
  const HASH = '0123456789abcdef';

  it('"trial" becomes a separate app that takes updates from the trial channel, signed, with the fingerprint', () => {
    const a = app();
    const next = applyOtaToApp({ app: a, config, variant: 'trial', nativeHash: HASH, certificateExists: true });
    const e = next.expo;
    assert.equal(e.name, 'Music space β');
    assert.equal(e.slug, 'music-space-trial');
    assert.equal(e.ios.bundleIdentifier, 'app.musicspace.player.trial');
    assert.equal(e.android.package, 'app.musicspace.player.trial');
    assert.equal(e.runtimeVersion, '1');
    assert.deepEqual(e.updates, {
      enabled: true,
      url: 'https://ota.example.com/ota/trial/manifest',
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      codeSigningCertificate: './ota/certificate.pem',
      codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
      requestHeaders: { 'x-native-hash': HASH },
    });
    assert.equal(e.extra.otaChannel, 'trial');
    assert.equal(e.extra.otaEnabled, true);
    assert.equal(a.expo.name, 'Music space', 'the input is not changed');
  });

  it('"prod" stays exactly as it is, with updates OFF, until it is enabled', () => {
    const next = applyOtaToApp({ app: app(), config, variant: 'prod', nativeHash: HASH, certificateExists: false });
    assert.deepEqual(next.expo.updates, { enabled: false });
    assert.equal(next.expo.name, 'Music space');
    assert.equal(next.expo.ios.bundleIdentifier, 'app.musicspace.player');
    assert.equal(next.expo.runtimeVersion, undefined);
    assert.equal(next.expo.extra.otaChannel, 'main');
    assert.equal(next.expo.extra.otaEnabled, false);
  });

  it('enabled for prod: the "main" channel, under the real name and id', () => {
    const next = applyOtaToApp({ app: app(), config: { ...config, enabledFor: ['trial', 'prod'] }, variant: 'prod', nativeHash: HASH, certificateExists: true });
    assert.equal(next.expo.updates.url, 'https://ota.example.com/ota/main/manifest');
    assert.equal(next.expo.name, 'Music space');
    assert.equal(next.expo.ios.bundleIdentifier, 'app.musicspace.player');
    assert.equal(channelOf('prod'), 'main');
  });

  it('an enabled variant without a certificate stops with the instruction; a disabled one does not care', () => {
    assert.throws(() => applyOtaToApp({ app: app(), config, variant: 'trial', nativeHash: HASH, certificateExists: false }), /certificate\.pem/);
    assert.doesNotThrow(() => applyOtaToApp({ app: app(), config, variant: 'prod', nativeHash: HASH, certificateExists: false }));
  });

  it('wrong input is refused', () => {
    assert.throws(() => applyOtaToApp({ app: app(), config, variant: 'beta' as never, nativeHash: HASH, certificateExists: true }), /prod か trial/);
    assert.throws(() => applyOtaToApp({ app: app(), config, variant: 'trial', nativeHash: 'xyz', certificateExists: true }), /nativeHash/);
  });

  it('the fingerprint is the same before and after the app is set up (so the app and the update agree)', () => {
    const root = project();
    const before = hashOf(root);
    const next = applyOtaToApp({ app: JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')), config, variant: 'trial', nativeHash: before, certificateExists: true });
    writeFileSync(path.join(root, 'app.json'), JSON.stringify(next));
    assert.equal(hashOf(root), before);
  });

  it('the command: writes app.json in the project it is run in, and tells what it did', () => {
    const root = project();
    mkdirSync(path.join(root, 'ota'));
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    cpSync('ota/native-hash.mjs', path.join(root, 'ota/native-hash.mjs'));
    cpSync('scripts/apply-ota.mjs', path.join(root, 'scripts/apply-ota.mjs'));
    writeFileSync(path.join(root, 'ota/config.json'), JSON.stringify(config));
    const run = (variant: string) => spawnSync(process.execPath, ['scripts/apply-ota.mjs', '--variant', variant], { cwd: root, encoding: 'utf8' });

    const noCert = run('trial');
    assert.notEqual(noCert.status, 0);
    assert.match(noCert.stderr, /certificate\.pem/);

    writeFileSync(path.join(root, 'ota/certificate.pem'), 'CERT');
    const want = hashOf(root);
    const ok = run('trial');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, new RegExp(`variant=trial updates=ON https://ota.example.com/ota/trial/manifest native=${want}`));
    const written = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));
    assert.equal(written.expo.updates.requestHeaders['x-native-hash'], want);
    assert.equal(written.expo.name, 'Music space β');

    const root2 = project();
    mkdirSync(path.join(root2, 'ota'));
    mkdirSync(path.join(root2, 'scripts'), { recursive: true });
    cpSync('ota/native-hash.mjs', path.join(root2, 'ota/native-hash.mjs'));
    cpSync('scripts/apply-ota.mjs', path.join(root2, 'scripts/apply-ota.mjs'));
    writeFileSync(path.join(root2, 'ota/config.json'), JSON.stringify(config));
    const prod = spawnSync(process.execPath, ['scripts/apply-ota.mjs', '--variant', 'prod'], { cwd: root2, encoding: 'utf8' });
    assert.equal(prod.status, 0, prod.stderr);
    assert.match(prod.stdout, /updates=OFF/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root2, 'app.json'), 'utf8')).expo.updates, { enabled: false });
  });
});

describe('the repository\'s own OTA settings', () => {
  it('ota/config.json is complete and valid', () => {
    const c = JSON.parse(readFileSync('ota/config.json', 'utf8'));
    assert.match(c.serverBase, /^https:\/\/[^/ ]+$/);
    assert.match(c.runtimeVersion, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
    assert.ok(Array.isArray(c.enabledFor) && c.enabledFor.every((v: string) => v === 'prod' || v === 'trial'));
  });
  it('production stays off until you turn it on; the committed app.json has updates OFF', () => {
    const c = JSON.parse(readFileSync('ota/config.json', 'utf8'));
    assert.ok(!c.enabledFor.includes('prod'), 'prod is not enabled (change this only after the trial app worked)');
    assert.deepEqual(JSON.parse(readFileSync('app.json', 'utf8')).expo.updates, { enabled: false });
  });
  it('expo-updates is a dependency, on the version of SDK 54', () => {
    const p = JSON.parse(readFileSync('package.json', 'utf8'));
    assert.match(p.dependencies['expo-updates'], /^~29\./);
  });
  it('the certificate is only needed once an enabled variant exists (never committed with a private key)', () => {
    assert.ok(!existsSync('ota/private-key.pem') && !existsSync('ota/keys'));
    const ignore = readFileSync('.gitignore', 'utf8');
    assert.ok(ignore.includes('private-key') || ignore.includes('*.key'), '.gitignore keeps private keys out');
  });
  it('a real certificate file, once added, is a certificate for signing', () => {
    if (!existsSync('ota/certificate.pem')) return; // not added yet
    const x = new X509Certificate(readFileSync('ota/certificate.pem'));
    assert.ok(x.validTo && new Date(x.validTo) > new Date(), 'not expired');
  });
});

describe('the note of an update', () => {
  const built = (note?: string, over: Record<string, unknown> = {}) => buildUpdate({ channel: 'trial', runtimeVersion: '1', nativeHash: '0123456789abcdef', baseUrl: 'https://example.com', distDir: dist(), privateKeyPem: null, note, ...over } as never);
  const bodyOf = (b: ReturnType<typeof built>) => JSON.parse(b.publish.platforms.ios.body) as { extra: { expoClient: unknown; releaseNote?: string } };

  it('goes into the manifest (inside what is signed), cleaned; the app settings stay beside it', () => {
    const b = bodyOf(built('  検索が速くなりました\u0000\n\n\n\nBPMを追加  ', { expoClient: { name: 'x' } }));
    assert.equal(b.extra.releaseNote, '検索が速くなりました\n\nBPMを追加');
    assert.deepEqual(b.extra.expoClient, { name: 'x' });
  });
  it('is the same on both platforms', () => {
    const b = built('同じ説明');
    assert.equal(JSON.parse(b.publish.platforms.ios.body).extra.releaseNote, JSON.parse(b.publish.platforms.android.body).extra.releaseNote);
  });
  it('nothing written, or only blanks: no note at all (and no empty field)', () => {
    for (const note of [undefined, '', '   ', '\n\n', '\u0000']) assert.ok(!('releaseNote' in bodyOf(built(note)).extra), JSON.stringify(note));
  });
  it('is cut at 400 letters', () => {
    assert.equal(Array.from(bodyOf(built('あ'.repeat(900))).extra.releaseNote!).length, 400);
  });
  it('is cleaned in exactly the same way as the app cleans it (so what is signed is what is shown)', () => {
    for (const v of ['  x  ', 'a\u0000b', '一\r\n\r\n\r\n\r\n二', 'x'.repeat(1000), '😀'.repeat(500), '', '   ', null, undefined, 5]) assert.equal(cleanReleaseNote(v), cleanNote(v), JSON.stringify(v)?.slice(0, 20));
  });
  it('the workflow takes it from an input, through the environment (never pasted into the command)', () => {
    const w = readFileSync('.github/workflows/ota-publish.yml', 'utf8');
    assert.match(w, /note:\n\s+description:[^\n]*\n\s+type: string/);
    assert.match(w, /OTA_NOTE: \$\{\{ inputs\.note \}\}/);
    assert.doesNotMatch(w, /run:[^\n]*inputs\.note/, 'the text of an input must never be part of a shell command');
  });
});
