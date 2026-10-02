import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { configure, defaultConfig } from '../src/core/config';
import { formatMatrix, resolveWithPoToken } from '../src/core/innertube/webpot';
import { bytesToBase64 } from '../src/core/lyrics/base64';
import { descramble, parseChallengeData, parseIntegrityTokenData, u8CsvToPoToken, ytBase64ToBytes } from '../src/core/pot/botguard';
import { JsEngine, setEngine } from '../src/core/pot/engine';
import { poTokenProvider } from '../src/core/pot/potoken';
import { getQueryParam, overrideSolverBundle, removeQueryParam, resetSolverState, setQueryParam } from '../src/core/pot/solver';
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
  it('removes parameters', () => {
    assert.equal(removeQueryParam('https://a/b?x=1&pot=T&y=2#h', 'pot'), 'https://a/b?x=1&y=2#h');
    assert.equal(removeQueryParam('https://a/b?pot=T', 'pot'), 'https://a/b');
  });
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

const b64u = (t: string) => Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const text = (t: string, status = 200) => new Response(t, { status });

function installNetwork(opts: { cipher?: boolean; probeStatus?: number; playability?: string; muxed?: boolean; probe?: (url: string, range: string) => number } = {}) {
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
          formats: opts.muxed
            ? [{ itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: 400000, contentLength: '9000000', url: 'https://rr1.googlevideo.com/videoplayback?expire=1&itag=18&n=nval' }]
            : [],
          adaptiveFormats: [
            { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://x/webm' },
            opts.cipher === false
              ? { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: '3456789', url: stream }
              : { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: '3456789', signatureCipher: `s=ABC&sp=sig&url=${encodeURIComponent(stream)}` },
          ],
        },
      });
    }
    if (url.includes('googlevideo.com')) {
      const range = String((init?.headers as Record<string, string>)?.Range ?? '');
      return new Response(null, { status: opts.probe ? opts.probe(url, range) : (opts.probeStatus ?? 206) });
    }
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

    // cipher: s "ABC" -> "CBA" in the `sig` param; n "nval" -> "lavn"; the video-bound token (preferred) is appended
    assert.equal(src.url, `https://rr1.googlevideo.com/videoplayback?expire=1&n=lavn&x=1&sig=CBA&pot=${b64u('pot-dQw4w9WgXcQ')}`);
    assert.equal(src.note, 'itag140 pot=video-bound');

    const playerCall = calls.find((c) => c.url.includes('/youtubei/v1/player'))!;
    const body = JSON.parse(String(playerCall.init?.body));
    assert.equal(body.context.client.clientName, 'WEB_REMIX');
    assert.equal(body.context.client.visitorData, 'VISITOR123');
    assert.equal(body.playbackContext.contentPlaybackContext.signatureTimestamp, 20512);
    assert.equal(body.serviceIntegrityDimensions.poToken, Buffer.from('pot-dQw4w9WgXcQ').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'));
    assert.equal((playerCall.init?.headers as Record<string, string>)['X-Goog-Visitor-Id'], 'VISITOR123');
  });

  it('can build the url with the player token, or without any pot (experiments)', async () => {
    installNetwork();
    const player = Buffer.from('pot-aaaaaaaaaaa').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const withPlayer = await resolveWithPoToken('aaaaaaaaaaa', { potMode: 'player' });
    assert.ok(withPlayer.url.endsWith(`&pot=${player}`));
    const none = await resolveWithPoToken('aaaaaaaaaaa', { potMode: 'none' });
    assert.ok(!none.url.includes('pot='));
    assert.ok(withPlayer.potTokens && none.potTokens);
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
    await assert.rejects(() => resolveWithPoToken('zzzzzzzzzzz'), /video-bound: HTTP 403, session-bound: HTTP 403/);
    // like the real AIZO case: the first bytes are served, anything further in is refused
    installNetwork();
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (String(input).includes('googlevideo.com') && range && range !== 'bytes=0-1') return new Response(null, { status: 403 });
      return real(input, init);
    }) as typeof fetch;
    await assert.rejects(() => resolveWithPoToken('zzzzzzzzzzz'), /rejected by YouTube \(video-bound: HTTP 403, session-bound: HTTP 403\)/);
  });

  it('falls back to the session-bound token when the video-bound one is refused', async () => {
    const videoPot = b64u('pot-dQw4w9WgXcQ');
    installNetwork({ probe: (url) => (url.includes(`pot=${videoPot}`) ? 403 : 206) });
    const src = await resolveWithPoToken('dQw4w9WgXcQ');
    assert.equal(src.note, 'itag140 pot=session-bound');
    assert.ok(src.url.endsWith(`pot=${b64u('pot-VISITOR123')}`));
  });

  it('also checks the MIDDLE of the file (a token can allow the first bytes only)', async () => {
    const seen: string[] = [];
    installNetwork({
      probe: (_url, range) => {
        seen.push(range);
        return range === 'bytes=0-1' ? 206 : 403; // exactly the AIZO symptom
      },
    });
    await assert.rejects(() => resolveWithPoToken('abcdefghijk'), /HTTP 403/);
    // contentLength 3456789 -> middle = 1728394
    assert.ok(seen.includes('bytes=1728394-1728395'), seen.join(' | '));
  });

  it('falls back to the muxed itag 18 (no pot needed) when the audio format is refused', async () => {
    installNetwork({
      muxed: true,
      probe: (url) => (url.includes('itag=18') && !url.includes('pot=') ? 206 : 403),
    });
    const src = await resolveWithPoToken('abcdefghijk');
    assert.equal(src.itag, 18);
    assert.equal(src.mimeType, 'video/mp4');
    assert.equal(src.note, 'itag18 pot=no pot');
    assert.ok(!src.url.includes('pot='));
    assert.match(src.url, /n=lavn/); // n was still solved
  });

  it('keeps the audio format when it works, even if a muxed one exists', async () => {
    installNetwork({ muxed: true });
    const src = await resolveWithPoToken('abcdefghijk');
    assert.equal(src.itag, 140);
  });

  it('reports every failed attempt when nothing is playable', async () => {
    installNetwork({ muxed: true, probeStatus: 403 });
    await assert.rejects(
      () => resolveWithPoToken('abcdefghijk'),
      /video-bound: HTTP 403, session-bound: HTTP 403\) \| itag 18: Stream URL rejected by YouTube \(no pot: HTTP 403, video-bound: HTTP 403, session-bound: HTTP 403\)/,
    );
  });

  it('forced pot modes never fall back to the muxed format', async () => {
    installNetwork({ muxed: true, probeStatus: 403 });
    await assert.rejects(() => resolveWithPoToken('abcdefghijk', { potMode: 'player' }), (e: Error) => !e.message.includes('itag 18'));
  });

  it('format matrix lists each audio/muxed format with all three token variants', async () => {
    installNetwork({ muxed: true, probe: (url) => (url.includes('itag=18') && !url.includes('pot=') ? 206 : 403) });
    const rows = await formatMatrix('abcdefghijk');
    assert.equal(rows.length, 3); // 251 webm, 140 m4a, 18 muxed
    const m18 = rows.find((r) => r.label.includes('itag 18'))!;
    assert.equal(m18.results, 'none 206 | video 403 | session 403');
    assert.match(rows.find((r) => r.label.includes('itag 140'))!.label, /\(cipher\)/);
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
