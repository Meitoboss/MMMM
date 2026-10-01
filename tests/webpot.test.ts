import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { configure, defaultConfig } from '../src/core/config';
import { resolveWithPoToken } from '../src/core/innertube/webpot';
import { bytesToBase64 } from '../src/core/lyrics/base64';
import { descramble, parseChallengeData, parseIntegrityTokenData, u8CsvToPoToken, ytBase64ToBytes } from '../src/core/pot/botguard';
import { JsEngine, setEngine } from '../src/core/pot/engine';
import { poTokenProvider } from '../src/core/pot/potoken';
import { getQueryParam, overrideSolverBundle, resetSolverState, setQueryParam } from '../src/core/pot/solver';
import { resolveAudio, clearStreamCache } from '../src/core/streams/resolver';

/** inverse of descramble(): subtract 97 from each byte, then YouTube-style base64 */
function scramble(text: string): string {
  const bytes = Array.from(Buffer.from(text, 'utf8')).map((b) => (b - 97) & 0xff);
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
}

const challengeArray = ['msg-id', [null, 'var SAFE=1;'], [null, 'https://trusted/url.js'], 'hash123', 'PROGRAM', 'globalName', null, 'experiments-blob'];

describe('botguard helpers', () => {
  it('descrambles (+97 per byte, YouTube base64) incl. non-ASCII', () => {
    const text = JSON.stringify(['é日本', 1]);
    assert.equal(descramble(scramble(text)), text);
  });
  it('parses scrambled and plain challenge data identically', () => {
    const expected = {
      messageId: 'msg-id',
      interpreterJavascript: { privateDoNotAccessOrElseSafeScriptWrappedValue: 'var SAFE=1;', privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: 'https://trusted/url.js' },
      interpreterHash: 'hash123',
      program: 'PROGRAM',
      globalName: 'globalName',
      clientExperimentsStateBlob: 'experiments-blob',
    };
    assert.deepEqual(parseChallengeData(JSON.stringify([null, challengeArray])), expected);
    assert.deepEqual(parseChallengeData(JSON.stringify([null, scramble(JSON.stringify(challengeArray))])), expected);
  });
  it('handles null interpreter slots', () => {
    const arr = ['m', null, null, 'h', 'p', 'g', null, 'b'];
    const r = parseChallengeData(JSON.stringify([null, arr]));
    assert.equal(r.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue, null);
  });
  it('parses integrity token + expiry', () => {
    const r = parseIntegrityTokenData('["AQID_w..", 43200]');
    assert.deepEqual(r.bytes, [1, 2, 3, 255]);
    assert.equal(r.expiresInSec, 43200);
    assert.deepEqual(ytBase64ToBytes('-_8.'), [251, 255]);
  });
  it('turns minted bytes into a url-safe PO token', () => {
    assert.equal(u8CsvToPoToken('251,255,254'), '-__-');
    assert.equal(u8CsvToPoToken('97,98,99'), 'YWJj');
    assert.equal(u8CsvToPoToken('97'), 'YQ==');
  });
});

describe('query helpers', () => {
  it('reads and replaces parameters without URL()', () => {
    const u = 'https://rr1.googlevideo.com/videoplayback?expire=1&n=abc%2Bdef&x=y#frag';
    assert.equal(getQueryParam(u, 'n'), 'abc+def');
    assert.equal(getQueryParam(u, 'missing'), undefined);
    assert.equal(setQueryParam(u, 'n', 'NEW'), 'https://rr1.googlevideo.com/videoplayback?expire=1&n=NEW&x=y#frag');
    assert.equal(setQueryParam('https://a/b', 'sig', 'a=b&c'), 'https://a/b?sig=a%3Db%26c');
  });
});

/* ---------- full flow with fake WebView engine + mocked network ---------- */

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];
const mints: string[] = [];
const engineCalls: string[] = [];

const fakeEngine: JsEngine = {
  async call(cmd, p: any = {}) {
    engineCalls.push(cmd);
    switch (cmd) {
      case 'botguard': return 'BGRESP' as never;
      case 'integrity': return true as never;
      case 'mint': mints.push(p.identifier); return Array.from(Buffer.from(`pot-${p.identifier}`)).join(',') as never;
      case 'loadSolver': return 'function' as never;
      case 'solve':
        return {
          responses: p.requests.map((r: any) => ({ type: 'result', data: Object.fromEntries(r.challenges.map((c: string) => [c, c.split('').reverse().join('')])) })),
        } as never;
      default: throw new Error(`unknown ${cmd}`);
    }
  },
};

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const text = (t: string, status = 200) => new Response(t, { status });

function installNetwork(opts: { cipher?: boolean; probeStatus?: number; playability?: string } = {}) {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/api/jnn/v1/Create')) return text(JSON.stringify([null, challengeArray]));
    if (url.endsWith('/api/jnn/v1/GenerateIT')) return text('["AQID", 43200]');
    if (url.includes('get_search_suggestions')) return json({ responseContext: { visitorData: 'VISITOR123' } });
    if (url.endsWith('/iframe_api')) return text('var x="https:\\/\\/www.youtube.com\\/s\\/player\\/abcd1234\\/www-widgetapi.vflset\\/www-widgetapi.js";');
    if (url.includes('/s/player/abcd1234/')) return text('var a={signatureTimestamp:20512,foo:1};');
    if (url.includes('/youtubei/v1/player')) {
      const stream = 'https://rr1.googlevideo.com/videoplayback?expire=1&n=nval&x=1';
      return json({
        playabilityStatus: { status: opts.playability ?? 'OK' },
        streamingData: {
          expiresInSeconds: '21540',
          adaptiveFormats: [
            { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://x/webm' },
            opts.cipher === false
              ? { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: '3456789', url: stream }
              : { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: '3456789', signatureCipher: `s=ABC&sp=sig&url=${encodeURIComponent(stream)}` },
          ],
        },
      });
    }
    if (url.includes('googlevideo.com')) return new Response(null, { status: opts.probeStatus ?? 206 });
    return json({}, 404);
  }) as typeof fetch;
}

describe('PO-token playback (RiMusic web-potoken flow)', () => {
  beforeEach(() => {
    configure({ ...defaultConfig });
    clearStreamCache();
    resetSolverState();
    poTokenProvider.reset();
    mints.length = 0;
    engineCalls.length = 0;
    overrideSolverBundle({ lib: 'LIB', core: 'CORE' });
    setEngine(fakeEngine);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    setEngine(null);
  });

  it('mints streaming token (visitorData) before the player token, builds the final URL', async () => {
    installNetwork();
    const src = await resolveWithPoToken('dQw4w9WgXcQ');

    assert.deepEqual(mints, ['VISITOR123', 'dQw4w9WgXcQ']);
    assert.equal(src.via, 'webpot');
    assert.equal(src.itag, 140);
    assert.equal(src.mimeType, 'audio/mp4');

    // cipher: s "ABC" -> "CBA" in the `sig` param; n "nval" -> "lavn"; streaming pot (url-safe base64 of "pot-VISITOR123") appended
    const pot = Buffer.from('pot-VISITOR123').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    assert.equal(src.url, `https://rr1.googlevideo.com/videoplayback?expire=1&n=lavn&x=1&sig=CBA&pot=${pot}`);

    const playerCall = calls.find((c) => c.url.includes('/youtubei/v1/player'))!;
    const body = JSON.parse(String(playerCall.init?.body));
    assert.equal(body.context.client.clientName, 'WEB_REMIX');
    assert.equal(body.context.client.visitorData, 'VISITOR123');
    assert.equal(body.playbackContext.contentPlaybackContext.signatureTimestamp, 20512);
    assert.equal(body.serviceIntegrityDimensions.poToken, Buffer.from('pot-dQw4w9WgXcQ').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'));
    assert.equal((playerCall.init?.headers as Record<string, string>)['X-Goog-Visitor-Id'], 'VISITOR123');
  });

  it('works with plain (non-ciphered) urls and only solves n', async () => {
    installNetwork({ cipher: false });
    const src = await resolveWithPoToken('abcdefghijk');
    assert.match(src.url, /n=lavn&x=1&pot=/);
    assert.ok(!src.url.includes('sig='));
  });

  it('reuses the BotGuard session for the next song (only the player token is minted)', async () => {
    installNetwork();
    await resolveWithPoToken('aaaaaaaaaaa');
    engineCalls.length = 0;
    mints.length = 0;
    await resolveWithPoToken('bbbbbbbbbbb');
    assert.deepEqual(mints, ['bbbbbbbbbbb']);
    assert.ok(!engineCalls.includes('botguard'));
    assert.ok(!engineCalls.includes('loadSolver'));
  });

  it('explains YouTube refusals and rejected stream urls', async () => {
    installNetwork({ playability: 'LOGIN_REQUIRED' });
    await assert.rejects(() => resolveWithPoToken('zzzzzzzzzzz'), /LOGIN_REQUIRED/);
    installNetwork({ probeStatus: 403 });
    await assert.rejects(() => resolveWithPoToken('zzzzzzzzzzz'), /HTTP 403/);
  });

  it('is the first backend in the resolver', async () => {
    installNetwork();
    const a = await resolveAudio('abcdefghijk', { order: ['webpot', 'piped'] });
    assert.equal(a.via, 'webpot');
    assert.ok(a.userAgent);
  });

  it('fails clearly when the solver bundle is missing', async () => {
    installNetwork();
    overrideSolverBundle({ lib: '', core: '' });
    await assert.rejects(() => resolveWithPoToken('abcdefghijk'), /fetch-solver/);
  });
});
