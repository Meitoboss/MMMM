import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { APP_VERSION } from '../src/appVersion';
import { type AppJson, APK_NAME, IPA_NAME, buildFeeds, releaseUrls } from '../src/core/releaseFeed';
import { altstoreLink, checkForUpdate, compareVersions, isHttpUrl, parseFeed, updateTarget, validVersion } from '../src/core/updateCheck';

const APP: AppJson = { expo: { name: 'Music space', version: '1.0.2', description: 'player', ios: { bundleIdentifier: 'app.musicspace.player', buildNumber: '3' }, android: { versionCode: 3 } } };

describe('version numbers', () => {
  it('compares the numbers, not the text', () => {
    assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
    assert.equal(compareVersions('1.0.9', '1.0.10'), -1);
    assert.equal(compareVersions('1.0.1', '1.0.1'), 0);
    assert.equal(compareVersions('1.1', '1.0.9'), 1);
    assert.equal(compareVersions('2', '1.9.9'), 1);
    assert.equal(compareVersions('1.0', '1.0.0'), 0, 'a missing part is 0');
    assert.equal(compareVersions('1.0.0.1', '1.0.0'), 1);
  });
  it('only dotted numbers are a version', () => {
    for (const v of ['1', '1.0', '1.0.1', '10.20.30.40']) assert.ok(validVersion(v), v);
    for (const v of ['', '1.', '.1', '1..1', '1.0.1-beta', 'v1.0.1', '1.0.1.2.3', 'a.b', '1.0.1000000', ' 1.0']) assert.ok(!validVersion(v), JSON.stringify(v));
  });
  it('the app\'s own version is valid', () => assert.ok(validVersion(APP_VERSION)));
});

describe('reading version.json', () => {
  const good = { version: '1.0.2', build: '3', date: '2026-10-06', notes: '音質の切り替え', ios: { url: 'https://h/a.ipa', altstoreSource: 'https://h/altstore.json' }, android: { url: 'https://h/a.apk' }, page: 'https://h/tag' };
  it('keeps what is there', () => {
    assert.deepEqual(parseFeed(good), { version: '1.0.2', build: '3', date: '2026-10-06', notes: '音質の切り替え', iosUrl: 'https://h/a.ipa', altstoreSource: 'https://h/altstore.json', androidUrl: 'https://h/a.apk', pageUrl: 'https://h/tag' });
  });
  it('only the version is needed', () => assert.deepEqual(parseFeed({ version: '2.0' }), { version: '2.0' }));
  it('addresses that are not web addresses are dropped (no javascript:, no files)', () => {
    const f = parseFeed({ version: '1.0.2', ios: { url: 'javascript:alert(1)', altstoreSource: 'file:///x' }, android: { url: 'https://ok/a.apk x' }, page: 'ftp://h' });
    assert.deepEqual(f, { version: '1.0.2' });
    assert.ok(isHttpUrl('https://example.com/a') && !isHttpUrl('example.com') && !isHttpUrl('https://'));
  });
  it('nonsense is null', () => {
    for (const j of [null, undefined, 3, 'x', [], {}, { version: 3 }, { version: 'latest' }, { version: '' }]) assert.equal(parseFeed(j), null, JSON.stringify(j));
  });
  it('long notes are cut', () => assert.equal(parseFeed({ version: '1', notes: 'あ'.repeat(1000) })?.notes?.length, 300));
});

describe('where "開く" goes', () => {
  const feed = parseFeed({ version: '1.0.2', ios: { url: 'https://h/a.ipa', altstoreSource: 'https://h/altstore.json' }, android: { url: 'https://h/a.apk' }, page: 'https://h/tag' })!;
  it('iPhone: AltStore with the source; without a source the release page', () => {
    assert.equal(updateTarget(feed, 'ios'), 'altstore://source?url=https%3A%2F%2Fh%2Faltstore.json');
    assert.equal(updateTarget({ version: '1', pageUrl: 'https://h/tag', iosUrl: 'https://h/a.ipa' }, 'ios'), 'https://h/tag');
    assert.equal(updateTarget({ version: '1', iosUrl: 'https://h/a.ipa' }, 'ios'), 'https://h/a.ipa');
  });
  it('Android: the APK; without one the release page', () => {
    assert.equal(updateTarget(feed, 'android'), 'https://h/a.apk');
    assert.equal(updateTarget({ version: '1', pageUrl: 'https://h/tag' }, 'android'), 'https://h/tag');
    assert.equal(updateTarget({ version: '1' }, 'android'), undefined);
  });
  it('the AltStore link keeps an address with ? and & whole', () => {
    assert.equal(altstoreLink('https://h/a?x=1&y=2'), 'altstore://source?url=https%3A%2F%2Fh%2Fa%3Fx%3D1%26y%3D2');
  });
});

describe('checking for an update', () => {
  const json = { version: '1.0.2', ios: { altstoreSource: 'https://h/altstore.json' }, android: { url: 'https://h/a.apk' } };
  it('a newer version: says so, with where to go', async () => {
    const r = await checkForUpdate('https://h/version.json', '1.0.1', 'android', async () => json);
    assert.equal(r.kind, 'newer');
    assert.equal(r.kind === 'newer' && r.target, 'https://h/a.apk');
  });
  it('the same or an older one: current (even when this app is newer than the feed)', async () => {
    assert.equal((await checkForUpdate('https://h/v', '1.0.2', 'ios', async () => json)).kind, 'current');
    assert.equal((await checkForUpdate('https://h/v', '1.0.3', 'ios', async () => json)).kind, 'current');
  });
  it('trouble is reported in words, never thrown', async () => {
    const bad = await checkForUpdate('not a url', '1.0.1', 'ios', async () => json);
    assert.equal(bad.kind === 'error' && /URL/.test(bad.message), true);
    const down = await checkForUpdate('https://h/v', '1.0.1', 'ios', async () => { throw new Error('HTTP 404'); });
    assert.equal(down.kind === 'error' && down.message.includes('HTTP 404'), true);
    const odd = await checkForUpdate('https://h/v', '1.0.1', 'ios', async () => ({ hello: 1 }));
    assert.equal(odd.kind === 'error' && /形式/.test(odd.message), true);
    assert.equal((await checkForUpdate('   ', '1.0.1', 'ios', async () => json)).kind, 'error');
  });
});

describe('the release files', () => {
  it('addresses: a public GitHub release, or your own server', () => {
    const gh = releaseUrls({ repo: 'me/music', tag: 'v1.0.2' });
    assert.equal(gh.ipa, `https://github.com/me/music/releases/download/v1.0.2/${IPA_NAME}`);
    assert.equal(gh.apk, `https://github.com/me/music/releases/download/v1.0.2/${APK_NAME}`);
    assert.equal(gh.altstore, 'https://github.com/me/music/releases/latest/download/altstore.json', 'the feed addresses always point at the newest release');
    assert.equal(gh.version, 'https://github.com/me/music/releases/latest/download/version.json');
    const own = releaseUrls({ repo: 'me/music', tag: 'v1.0.2', base: 'https://example.com/musicspace/' });
    assert.deepEqual([own.ipa, own.apk, own.altstore, own.version], ['https://example.com/musicspace/' + IPA_NAME, 'https://example.com/musicspace/' + APK_NAME, 'https://example.com/musicspace/altstore.json', 'https://example.com/musicspace/version.json']);
  });

  it('the app can read what the workflow writes (the two sides agree)', () => {
    const { feed } = buildFeeds({ app: APP, repo: 'me/music', tag: 'v1.0.2', notes: '  音質を選べます  ', date: '2026-10-06' });
    const read = parseFeed(feed);
    assert.deepEqual(read, {
      version: '1.0.2', build: '3', date: '2026-10-06', notes: '音質を選べます',
      iosUrl: `https://github.com/me/music/releases/download/v1.0.2/${IPA_NAME}`,
      altstoreSource: 'https://github.com/me/music/releases/latest/download/altstore.json',
      androidUrl: `https://github.com/me/music/releases/download/v1.0.2/${APK_NAME}`,
      pageUrl: 'https://github.com/me/music/releases/tag/v1.0.2',
    });
  });

  it('the AltStore source: the app, its version, where to download, how big', () => {
    const { altstore } = buildFeeds({ app: APP, repo: 'me/music', tag: 'v1.0.2', ipaSize: 123456789, date: '2026-10-06' });
    assert.equal(altstore.sourceURL, 'https://github.com/me/music/releases/latest/download/altstore.json');
    const app = altstore.apps[0];
    assert.equal(app.bundleIdentifier, 'app.musicspace.player');
    assert.deepEqual({ ...app.versions[0] }, { version: '1.0.2', buildVersion: '3', date: '2026-10-06', localizedDescription: '', downloadURL: `https://github.com/me/music/releases/download/v1.0.2/${IPA_NAME}`, size: 123456789, minOSVersion: '15.1' });
    assert.equal(app.version, '1.0.2', 'the older source format fields are there too');
    assert.equal(app.size, 123456789);
    assert.equal(app.downloadURL, app.versions[0].downloadURL);
    assert.deepEqual(altstore.news, []);
  });

  it('without the IPA size there is no size field (rather than a wrong one)', () => {
    const { altstore } = buildFeeds({ app: APP, repo: 'me/music', tag: 'v1.0.2' });
    assert.ok(!('size' in altstore.apps[0].versions[0]) && !('size' in altstore.apps[0]));
  });

  it('the date defaults to today; notes are cut at 300 characters', () => {
    const { feed } = buildFeeds({ app: APP, repo: 'a/b', tag: 'v1', notes: 'x'.repeat(500) });
    assert.match(feed.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(feed.notes.length, 300);
  });

  it('with the real app.json: the version and the app id are the app\'s own', () => {
    const app = JSON.parse(readFileSync('app.json', 'utf8')) as AppJson;
    const { feed, altstore } = buildFeeds({ app, repo: 'me/music', tag: `v${app.expo.version}` });
    assert.equal(feed.version, APP_VERSION);
    assert.equal(altstore.apps[0].bundleIdentifier, 'app.musicspace.player');
    assert.equal(feed.build, String(app.expo.android?.versionCode));
  });
});

describe('the release script', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [...process.execArgv, 'scripts/make-release-feed.ts', ...args], { encoding: 'utf8' });

  it('writes version.json and altstore.json (with the IPA size)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'));
    const ipa = join(dir, 'a.ipa');
    writeFileSync(ipa, Buffer.alloc(2048));
    const r = run(['--repo', 'me/music', '--tag', 'v1.0.1', '--ipa', ipa, '--out', join(dir, 'out'), '--notes', 'テスト']);
    assert.equal(r.status, 0, r.stderr);
    const v = JSON.parse(readFileSync(join(dir, 'out/version.json'), 'utf8'));
    const a = JSON.parse(readFileSync(join(dir, 'out/altstore.json'), 'utf8'));
    assert.equal(v.version, APP_VERSION);
    assert.equal(v.notes, 'テスト');
    assert.equal(a.apps[0].versions[0].size, 2048);
    assert.equal(parseFeed(v)?.version, APP_VERSION);
  });

  it('"--only version" (the Android job) never writes altstore.json – it must not overwrite the iOS one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'));
    const r = run(['--repo', 'me/music', '--tag', 'v1.0.1', '--only', 'version', '--out', join(dir, 'out')]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, 'out/version.json')));
    assert.ok(!existsSync(join(dir, 'out/altstore.json')));
  });

  it('refuses to make an AltStore source without the IPA, and to run without repo and tag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'));
    assert.notEqual(run(['--repo', 'me/music', '--tag', 'v1', '--out', join(dir, 'o')]).status, 0);
    const noTag = spawnSync(process.execPath, [...process.execArgv, 'scripts/make-release-feed.ts'], { encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: '', GITHUB_REF_NAME: '' } });
    assert.notEqual(noTag.status, 0);
  });
});
