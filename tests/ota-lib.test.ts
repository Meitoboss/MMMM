import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  boundaryOf,
  buildPlatformManifest,
  buildRollbackDirective,
  isAssetHash,
  isChannel,
  isIsoDate,
  isMime,
  isNativeHash,
  isPlatform,
  isRuntimeVersion,
  isUuid,
  md5hex,
  mimeForExt,
  multipartBody,
  newBoundary,
  parseMultipart,
  parseSignatureHeader,
  sha256b64u,
  signRsaSha256,
  signatureHeader,
  verifyRsaSha256,
} from '../ota/lib.mjs';

describe('names that end up in paths and URLs', () => {
  it('channels: short, lower-case, no dots or slashes', () => {
    for (const ok of ['main', 'trial', 'a', 'beta-2']) assert.ok(isChannel(ok), ok);
    for (const bad of ['', 'Main', '../x', 'a/b', 'a.b', '-x', 'x'.repeat(33), 'a b', undefined, 5]) assert.ok(!isChannel(bad as never), String(bad));
  });
  it('runtime versions', () => {
    for (const ok of ['1', '1.0.1', 'native-2', 'a_b']) assert.ok(isRuntimeVersion(ok), ok);
    for (const bad of ['', '.hidden', '../1', 'a/b', 'a b', 'x'.repeat(65)]) assert.ok(!isRuntimeVersion(bad), bad);
  });
  it('native hashes are 16 hex characters', () => {
    assert.ok(isNativeHash('0123456789abcdef'));
    for (const bad of ['0123456789ABCDEF', '0123456789abcde', '0123456789abcdefg', '../../etc/passwd', '']) assert.ok(!isNativeHash(bad), bad);
  });
  it('asset hashes are 43 characters of base64url', () => {
    assert.ok(isAssetHash(sha256b64u(Buffer.from('x'))));
    for (const bad of ['', 'abc', '../'.repeat(15), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}/`]) assert.ok(!isAssetHash(bad), bad);
  });
  it('uuid, platform, date, mime', () => {
    assert.ok(isUuid('123e4567-e89b-12d3-a456-426614174000') && !isUuid('123') && !isUuid('123e4567-e89b-12d3-a456-42661417400Z'));
    assert.ok(isPlatform('ios') && isPlatform('android') && !isPlatform('web') && !isPlatform('*'));
    assert.ok(isIsoDate('2026-10-08T12:00:00.000Z') && !isIsoDate('yesterday') && !isIsoDate('2026-10-08') && !isIsoDate(`2026-10-08T${'0'.repeat(60)}`));
    assert.ok(isMime('image/png') && isMime('application/javascript') && !isMime('image') && !isMime('a/b c') && !isMime('x/y\r\nz: 1'));
  });
});

describe('hashes and types', () => {
  it('SHA-256 as base64url (what the client verifies), MD5 as hex (the asset key)', () => {
    assert.equal(sha256b64u(Buffer.from('')), '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
    assert.equal(md5hex(Buffer.from('')), 'd41d8cd98f00b204e9800998ecf8427e');
  });
  it('content types by extension; unknown is binary', () => {
    assert.equal(mimeForExt('png'), 'image/png');
    assert.equal(mimeForExt('.TTF'), 'font/ttf');
    assert.equal(mimeForExt('weird'), 'application/octet-stream');
    assert.equal(mimeForExt(undefined), 'application/octet-stream');
  });
});

describe('the manifest of one platform', () => {
  const files: Record<string, Buffer> = {
    '_expo/static/js/ios/index-abc.hbc': Buffer.from('BUNDLE-IOS'),
    'assets/aaa': Buffer.from('PNG-A'),
    'assets/bbb': Buffer.from('FONT-B'),
  };
  const build = () =>
    buildPlatformManifest({
      id: '123e4567-e89b-12d3-a456-426614174000',
      createdAt: '2026-10-08T12:00:00.000Z',
      runtimeVersion: '1',
      meta: { bundle: '_expo/static/js/ios/index-abc.hbc', assets: [{ path: 'assets/aaa', ext: 'png' }, { path: 'assets/bbb', ext: 'ttf' }] },
      readFile: (p) => {
        if (!files[p]) throw new Error(`no file ${p}`);
        return files[p];
      },
      baseUrl: 'https://example.com/',
      expoClient: { name: 'Music space' },
    });

  it('has the fields the client needs, with real hashes and public addresses', () => {
    const { manifest, files: out } = build();
    assert.equal(manifest.id, '123e4567-e89b-12d3-a456-426614174000');
    assert.equal(manifest.runtimeVersion, '1');
    assert.equal(manifest.launchAsset.contentType, 'application/javascript');
    assert.ok(!('fileExtension' in manifest.launchAsset), 'the launch asset has no extension');
    assert.equal(manifest.launchAsset.hash, sha256b64u(files['_expo/static/js/ios/index-abc.hbc']));
    assert.equal(manifest.launchAsset.url, `https://example.com/ota/assets/${manifest.launchAsset.hash}`, 'no double slash');
    assert.deepEqual(manifest.assets.map((a: { fileExtension: string; contentType: string }) => [a.fileExtension, a.contentType]), [['.png', 'image/png'], ['.ttf', 'font/ttf']]);
    assert.equal(manifest.assets[0].key, md5hex(files['assets/aaa']));
    assert.deepEqual(manifest.metadata, {});
    assert.deepEqual(manifest.extra, { expoClient: { name: 'Music space' } });
    assert.equal(out.size, 3, 'every file once, by its hash');
    assert.equal(out.get(manifest.assets[1].hash)?.contentType, 'font/ttf');
  });

  it('a damaged metadata.json is reported in words', () => {
    assert.throws(() => buildPlatformManifest({ id: 'x', createdAt: 'x', runtimeVersion: '1', meta: {} as never, readFile: () => Buffer.alloc(0), baseUrl: 'https://h' }), /metadata\.json/);
  });

  it('a missing file stops the build (rather than publishing a broken update)', () => {
    assert.throws(() => buildPlatformManifest({ id: 'x', createdAt: 'x', runtimeVersion: '1', meta: { bundle: 'nope', assets: [] }, readFile: () => { throw new Error('ENOENT'); }, baseUrl: 'https://h' }), /ENOENT/);
  });
});

describe('signing', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

  it('a signature verifies for exactly the text that was signed', () => {
    const text = JSON.stringify({ id: 'a', n: 1 });
    const sig = signRsaSha256(text, privateKey);
    assert.ok(verifyRsaSha256(text, sig, publicKey));
    assert.ok(!verifyRsaSha256(`${text} `, sig, publicKey), 'one extra space');
    assert.ok(!verifyRsaSha256(text, sig.slice(0, -4) + 'AAAA', publicKey), 'damaged signature');
    assert.ok(!verifyRsaSha256(text, 'not base64 !!', publicKey));
    assert.ok(!verifyRsaSha256(text, sig, 'not a key'), 'a bad key is "no", not an exception');
  });

  it('the header is a dictionary with quoted strings, and can be read back', () => {
    const h = signatureHeader('QUJD/+==', 'main');
    assert.equal(h, 'sig="QUJD/+==", keyid="main"');
    assert.deepEqual(parseSignatureHeader(h), { sig: 'QUJD/+==', keyid: 'main' });
    assert.equal(parseSignatureHeader('keyid="main"'), null);
    assert.equal(parseSignatureHeader(undefined), null);
    assert.equal(parseSignatureHeader('x'.repeat(5000)), null);
  });

  it('the rollback directive', () => {
    assert.deepEqual(buildRollbackDirective('2026-10-08T12:00:00.000Z'), { type: 'rollBackToEmbedded', parameters: { commitTime: '2026-10-08T12:00:00.000Z' } });
  });
});

describe('multipart/mixed', () => {
  it('builds and reads back parts, headers and bodies (also with JSON that contains line breaks and dashes)', () => {
    const b = newBoundary();
    const body = multipartBody(
      [
        { name: 'manifest', headers: { 'content-type': 'application/json; charset=utf-8', 'expo-signature': 'sig="x", keyid="main"' }, body: '{"a":"--b\\n","c":[1,2]}' },
        { name: 'extensions', headers: { 'content-type': 'application/json' }, body: '{"assetRequestHeaders":{}}' },
      ],
      b,
    );
    const parts = parseMultipart(body, b);
    assert.deepEqual(parts.map((p) => p.name), ['manifest', 'extensions']);
    assert.equal(parts[0].body, '{"a":"--b\\n","c":[1,2]}');
    assert.equal(parts[0].headers['expo-signature'], 'sig="x", keyid="main"');
    assert.equal(parts[1].headers['content-type'], 'application/json');
    assert.match(body.toString('utf8'), new RegExp(`--${b}--\\r\\n$`));
  });
  it('boundaries are unique and read from the content type', () => {
    assert.notEqual(newBoundary(), newBoundary());
    assert.equal(boundaryOf('multipart/mixed; boundary=ota-abc'), 'ota-abc');
    assert.equal(boundaryOf('application/json'), null);
  });
  it('no parts is an empty list', () => assert.deepEqual(parseMultipart(multipartBody([], 'zz'), 'zz'), []));
});
