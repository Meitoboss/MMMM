import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MatchResult } from '../src/core/importer';
import {
  CHART_TTL_MS,
  type TrendCache,
  type TrendEntry,
  type TrendingDeps,
  acceptMatch,
  bucketLimit,
  chartUrls,
  cleanCountry,
  countryLabel,
  fetchChart,
  isFresh,
  loadTrending,
  parseAppleChart,
} from '../src/core/trending';
import type { MusicItem, SongItem } from '../src/core/types';

const V2 = {
  feed: {
    title: 'Top Songs',
    country: 'jp',
    results: [
      { id: '1', name: 'Idol', artistName: 'YOASOBI', artworkUrl100: 'https://x/100x100bb.jpg', url: 'https://music.apple.com/jp/song/1', kind: 'songs' },
      { id: '2', name: 'Pretender', artistName: 'Official髭男dism', artworkUrl100: 'https://x/100x100bb.jpg' },
      { id: '3', name: '  ', artistName: 'blank title is skipped' },
      { id: '4', name: 'Subtitle', artistName: 'Official髭男dism' },
    ],
  },
};
const LEGACY = {
  feed: {
    entry: [
      { 'im:name': { label: 'Lemon' }, 'im:artist': { label: '米津玄師' }, 'im:image': [{ label: 'https://x/55x55bb.png' }, { label: 'https://x/170x170bb.png' }], link: { attributes: { href: 'https://itunes.apple.com/jp/album/1' } } },
      { 'im:name': { label: 'KICK BACK' }, 'im:artist': { label: '米津玄師' } },
    ],
  },
};

const song = (id: string, title: string, artist: string): SongItem => ({ kind: 'song', id, title, artists: [{ name: artist }], explicit: false });
const matchRes = (status: MatchResult['status'], titleScore: number, best?: SongItem): MatchResult => ({
  track: { title: 't', raw: '1' },
  status,
  best,
  score: 0.5,
  candidates: best ? [{ song: best, score: 0.5, titleScore }] : [],
});

describe('Apple chart: reading the feed', () => {
  it('the current format: rank, title, artist, a bigger cover, the link', () => {
    const c = parseAppleChart(V2);
    assert.deepEqual(c.map((e) => [e.rank, e.title, e.artist]), [[1, 'Idol', 'YOASOBI'], [2, 'Pretender', 'Official髭男dism'], [3, 'Subtitle', 'Official髭男dism']], 'a blank title is skipped and the ranks stay 1, 2, 3');
    assert.equal(c[0].artworkUrl, 'https://x/300x300bb.jpg');
    assert.equal(c[0].appleUrl, 'https://music.apple.com/jp/song/1');
    assert.equal(c[2].artworkUrl, undefined);
  });

  it('the old iTunes format, also with a single entry', () => {
    const c = parseAppleChart(LEGACY);
    assert.deepEqual(c.map((e) => [e.rank, e.title, e.artist]), [[1, 'Lemon', '米津玄師'], [2, 'KICK BACK', '米津玄師']]);
    assert.equal(c[0].artworkUrl, 'https://x/170x170bb.png', 'the last (largest) image');
    assert.equal(c[0].appleUrl, 'https://itunes.apple.com/jp/album/1');
    const one = parseAppleChart({ feed: { entry: { 'im:name': { label: 'Solo' }, 'im:artist': { label: 'A' } } } });
    assert.deepEqual(one.map((e) => e.title), ['Solo']);
  });

  it('anything else is an empty chart, never an exception', () => {
    for (const junk of [null, undefined, 5, 'x', [], {}, { feed: null }, { feed: { results: 'no' } }, { feed: { results: [null, 3, {}] } }, { feed: { entry: [null, 'x'] } }]) assert.deepEqual(parseAppleChart(junk), [], JSON.stringify(junk));
  });
});

describe('Apple chart: addresses and sizes', () => {
  it('the feed address for a country and a size; the old feed second', () => {
    const [a, b] = chartUrls('jp', 25);
    assert.equal(a, 'https://rss.marketingtools.apple.com/api/v2/jp/music/most-played/25/songs.json');
    assert.equal(b, 'https://itunes.apple.com/jp/rss/topsongs/limit=25/json');
  });
  it('only a known country goes into an address', () => {
    assert.equal(cleanCountry('US'), 'us');
    assert.equal(cleanCountry(' kr '), 'kr');
    assert.equal(cleanCountry('../../etc'), 'jp');
    assert.equal(cleanCountry(''), 'jp');
    assert.equal(cleanCountry(undefined), 'jp');
    assert.ok(chartUrls('x/../y', 10).every((u) => u.includes('/jp/')));
    assert.equal(countryLabel('jp'), '日本');
    assert.equal(countryLabel('zz'), 'ZZ');
  });
  it('the feed offers 10 / 25 / 50 / 100', () => {
    assert.deepEqual([1, 10, 11, 25, 26, 50, 51, 100, 500].map(bucketLimit), [10, 10, 25, 25, 50, 50, 100, 100, 100]);
  });
});

describe('Apple chart: fetching', () => {
  it('the first address that works is used and the second is never asked', async () => {
    const asked: string[] = [];
    const c = await fetchChart('jp', 25, async (u) => (asked.push(u), V2));
    assert.equal(c.length, 3);
    assert.equal(asked.length, 1);
  });
  it('falls back to the old feed when the new one fails or is empty', async () => {
    const asked: string[] = [];
    const c = await fetchChart('jp', 10, async (u) => {
      asked.push(u);
      if (u.includes('marketingtools')) throw new Error('HTTP 404');
      return LEGACY;
    });
    assert.deepEqual(c.map((e) => e.title), ['Lemon', 'KICK BACK']);
    assert.equal(asked.length, 2);
    const c2 = await fetchChart('jp', 10, async (u) => (u.includes('marketingtools') ? { feed: { results: [] } } : LEGACY));
    assert.equal(c2.length, 2);
  });
  it('both fail: one clear error with the reasons', async () => {
    await assert.rejects(
      () => fetchChart('jp', 10, async (u) => { throw new Error(u.includes('marketingtools') ? 'HTTP 503' : 'timeout'); }),
      /ランキングを取得できませんでした.*HTTP 503.*timeout/,
    );
    await assert.rejects(() => fetchChart('jp', 10, async () => ({ junk: true })), /中身が空/);
  });
  it('never returns more than asked', async () => {
    const big = { feed: { results: Array.from({ length: 30 }, (_, i) => ({ name: `s${i}`, artistName: 'a' })) } };
    assert.equal((await fetchChart('jp', 10, async () => big)).length, 10);
  });
});

describe('matching a chart entry to YouTube Music', () => {
  it('sure matches are used; a right title with a differently written artist is too; the rest is not', () => {
    const s = song('y1', 'Idol', 'YOASOBI');
    assert.equal(acceptMatch(matchRes('matched', 1, s)), s);
    assert.equal(acceptMatch(matchRes('maybe', 0.9, s)), s);
    assert.equal(acceptMatch(matchRes('maybe', 0.5, s)), undefined, 'might be another song');
    assert.equal(acceptMatch(matchRes('none', 0.3)), undefined);
  });
});

describe('loading the chart', () => {
  const NOW = 1_000_000_000_000;
  /** a YouTube Music that knows every song it is asked for (by the title in the query) */
  function make(opts: { chart?: unknown; cache?: TrendCache | null; failChart?: boolean } = {}) {
    const asked: string[] = [];
    const searched: string[] = [];
    const written: TrendCache[] = [];
    let cache: TrendCache | null = opts.cache ?? null;
    const deps: TrendingDeps = {
      getJson: async (u) => {
        asked.push(u);
        if (opts.failChart) throw new Error('offline');
        return opts.chart ?? V2;
      },
      search: async (q): Promise<MusicItem[]> => {
        searched.push(q);
        const hit = ['Idol', 'Pretender', 'Subtitle'].find((t) => q.includes(t));
        return hit ? [song(`yt-${hit}`, hit, hit === 'Idol' ? 'YOASOBI' : 'Official髭男dism')] : [];
      },
      readCache: () => cache,
      writeCache: (c) => { written.push(c); cache = c; },
      now: () => NOW,
    };
    return { deps, asked, searched, written };
  }
  const titles = (e: TrendEntry[]) => e.map((x) => `${x.rank}:${x.title}:${x.status}`);

  it('first time: fetches, shows the chart at once (pending), then fills in the songs one by one, and saves', async () => {
    const t = make();
    const updates: string[][] = [];
    const out = await loadTrending({ country: 'jp', limit: 25 }, t.deps, (e) => updates.push(titles(e)));
    assert.deepEqual(updates[0], ['1:Idol:pending', '2:Pretender:pending', '3:Subtitle:pending'], 'the chart is on screen before any song is found');
    assert.ok(updates.length >= 4, 'one update per found song');
    assert.deepEqual(titles(out), ['1:Idol:matched', '2:Pretender:matched', '3:Subtitle:matched']);
    assert.equal(out[0].song?.id, 'yt-Idol');
    assert.equal(t.written.at(-1)?.entries.length, 3);
    assert.equal(t.written.at(-1)?.country, 'jp');
  });

  it('a song that cannot be found is marked as such, and the others still work', async () => {
    const t = make({ chart: { feed: { results: [{ name: 'Idol', artistName: 'YOASOBI' }, { name: 'Unknown Song', artistName: 'Nobody' }] } } });
    const out = await loadTrending({ country: 'jp', limit: 10 }, t.deps, () => undefined);
    assert.deepEqual(titles(out), ['1:Idol:matched', '2:Unknown Song:none']);
  });

  it('a fresh saved chart: no network, no search', async () => {
    const first = make();
    await loadTrending({ country: 'jp', limit: 25 }, first.deps, () => undefined);
    const t = make({ cache: first.written.at(-1)! });
    const out = await loadTrending({ country: 'jp', limit: 25 }, t.deps, () => undefined);
    assert.equal(t.asked.length, 0);
    assert.equal(t.searched.length, 0);
    assert.equal(out.length, 3);
  });

  it('an old chart is fetched again, but songs found before are not searched again', async () => {
    const first = make();
    await loadTrending({ country: 'jp', limit: 25 }, first.deps, () => undefined);
    const old = { ...first.written.at(-1)!, fetchedAt: NOW - CHART_TTL_MS - 1 };
    const next = { feed: { results: [{ name: 'Idol', artistName: 'YOASOBI' }, { name: 'Subtitle', artistName: 'Official髭男dism' }] } }; // Pretender dropped out, order changed
    const t = make({ cache: old, chart: next });
    const out = await loadTrending({ country: 'jp', limit: 25 }, t.deps, () => undefined);
    assert.equal(t.asked.length, 1);
    assert.equal(t.searched.length, 0, 'both songs were known');
    assert.deepEqual(titles(out), ['1:Idol:matched', '2:Subtitle:matched']);
  });

  it('"force" fetches again even when the saved chart is fresh', async () => {
    const first = make();
    await loadTrending({ country: 'jp', limit: 25 }, first.deps, () => undefined);
    const t = make({ cache: first.written.at(-1)! });
    await loadTrending({ country: 'jp', limit: 25, force: true }, t.deps, () => undefined);
    assert.equal(t.asked.length, 1);
    assert.equal(t.searched.length, 0);
  });

  it('another country, or a longer list than saved: not the same chart', async () => {
    const first = make();
    await loadTrending({ country: 'jp', limit: 10 }, first.deps, () => undefined);
    const saved = first.written.at(-1)!;
    assert.equal(isFresh(saved, 'us', 10, NOW), false);
    assert.equal(isFresh(saved, 'jp', 25, NOW), false);
    assert.equal(isFresh(saved, 'jp', 10, NOW), true);
    assert.equal(isFresh(saved, 'jp', 10, NOW + CHART_TTL_MS + 1), false);
    assert.equal(isFresh(saved, 'jp', 10, NOW - 1), false, 'a clock that went back');
    assert.equal(isFresh(null, 'jp', 10, NOW), false);
  });

  it('a longer saved chart serves a shorter request', async () => {
    const big = { feed: { results: Array.from({ length: 12 }, (_, i) => ({ name: i % 3 === 0 ? 'Idol' : i % 3 === 1 ? 'Pretender' : 'Subtitle', artistName: `a${i}` })) } };
    const first = make({ chart: big });
    await loadTrending({ country: 'jp', limit: 25 }, first.deps, () => undefined);
    const t = make({ cache: first.written.at(-1)! });
    const out = await loadTrending({ country: 'jp', limit: 10 }, t.deps, () => undefined);
    assert.equal(out.length, 10);
    assert.equal(t.asked.length, 0);
  });

  it('the chart cannot be fetched: the old chart is shown and the error is thrown; with no old chart, just the error', async () => {
    const first = make();
    await loadTrending({ country: 'jp', limit: 25 }, first.deps, () => undefined);
    const old = { ...first.written.at(-1)!, fetchedAt: NOW - CHART_TTL_MS - 1 };
    const t = make({ cache: old, failChart: true });
    const seen: number[] = [];
    await assert.rejects(() => loadTrending({ country: 'jp', limit: 25 }, t.deps, (e) => seen.push(e.length)), /ランキングを取得できませんでした/);
    assert.deepEqual(seen, [3], 'the old chart was shown');

    const none = make({ failChart: true });
    const seen2: number[] = [];
    await assert.rejects(() => loadTrending({ country: 'jp', limit: 25 }, none.deps, (e) => seen2.push(e.length)));
    assert.deepEqual(seen2, []);
  });

  it('another country does not borrow the old country\'s old chart on an error', async () => {
    const first = make();
    await loadTrending({ country: 'jp', limit: 25 }, first.deps, () => undefined);
    const t = make({ cache: { ...first.written.at(-1)!, fetchedAt: NOW - CHART_TTL_MS - 1 }, failChart: true });
    const seen: number[] = [];
    await assert.rejects(() => loadTrending({ country: 'us', limit: 25 }, t.deps, (e) => seen.push(e.length)));
    assert.deepEqual(seen, []);
  });

  it('cancelled halfway (the user changed the country): stops, shows nothing more, saves nothing', async () => {
    const t = make({ chart: { feed: { results: Array.from({ length: 9 }, (_, i) => ({ name: 'Idol', artistName: `a${i}` })) } } });
    let cancelled = false;
    let updates = 0;
    await loadTrending({ country: 'jp', limit: 10, isCancelled: () => cancelled }, t.deps, () => { updates += 1; if (updates === 3) cancelled = true; });
    assert.ok(updates <= 4, `updates stop soon after the cancel (${updates})`);
    assert.equal(t.written.length, 0);
  });

  it('a half-finished save is picked up: only the missing songs are searched', async () => {
    const first = make();
    await loadTrending({ country: 'jp', limit: 25 }, first.deps, () => undefined);
    const saved = first.written.at(-1)!;
    const half: TrendCache = { ...saved, entries: saved.entries.map((e, i) => (i === 1 ? { ...e, status: 'pending', song: undefined } : e)) };
    const t = make({ cache: half });
    const out = await loadTrending({ country: 'jp', limit: 25 }, t.deps, () => undefined);
    assert.equal(t.asked.length, 0);
    assert.equal(t.searched.length >= 1 && t.searched.every((q) => q.includes('Pretender')), true);
    assert.equal(out[1].status, 'matched');
  });
});
