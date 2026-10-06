import { type ImportTrack, type MatchResult, type SearchFn, matchAll } from './importer';
import type { SongItem } from './types';

/**
 * "流行": the chart of what is played most in a country (Apple Music's public RSS feed – no key, no login),
 * turned into songs of YouTube Music with the same matching the playlist import uses. Playing is unchanged: it is
 * the YouTube Music song that plays.
 */
export interface ChartEntry {
  rank: number;
  title: string;
  artist: string;
  artworkUrl?: string;
  appleUrl?: string;
}

export interface TrendEntry extends ChartEntry {
  status: 'pending' | 'matched' | 'none';
  song?: SongItem;
}

export interface TrendCache {
  v: 1;
  country: string;
  limit: number;
  fetchedAt: number;
  entries: TrendEntry[];
}

export const COUNTRIES: { code: string; label: string }[] = [
  { code: 'jp', label: '日本' },
  { code: 'us', label: 'アメリカ' },
  { code: 'kr', label: '韓国' },
  { code: 'gb', label: 'イギリス' },
  { code: 'tw', label: '台湾' },
  { code: 'hk', label: '香港' },
  { code: 'th', label: 'タイ' },
  { code: 'de', label: 'ドイツ' },
  { code: 'fr', label: 'フランス' },
  { code: 'br', label: 'ブラジル' },
  { code: 'au', label: 'オーストラリア' },
  { code: 'ca', label: 'カナダ' },
];
export const LIMITS = [10, 25, 50, 100] as const; // what the feed offers
export const DEFAULT_COUNTRY = 'jp';
export const CHART_TTL_MS = 3 * 60 * 60 * 1000; // a chart changes slowly: 3 hours

export const countryLabel = (code: string): string => COUNTRIES.find((c) => c.code === code)?.label ?? code.toUpperCase();

/** only a known two-letter storefront is put into a URL */
export function cleanCountry(code: string | undefined): string {
  const c = (code ?? '').trim().toLowerCase();
  return COUNTRIES.some((x) => x.code === c) ? c : DEFAULT_COUNTRY;
}

/** the feed has 10 / 25 / 50 / 100: the smallest one that has at least `n` songs */
export function bucketLimit(n: number): (typeof LIMITS)[number] {
  return LIMITS.find((l) => l >= n) ?? 100;
}

/** the current feed first, the old iTunes feed as a second try */
export function chartUrls(country: string, limit: number): string[] {
  const c = cleanCountry(country);
  const n = bucketLimit(limit);
  return [`https://rss.marketingtools.apple.com/api/v2/${c}/music/most-played/${n}/songs.json`, `https://itunes.apple.com/${c}/rss/topsongs/limit=${n}/json`];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const bigger = (url: string): string => (url.includes('100x100') ? url.split('100x100').join('300x300') : url);

/** Reads both feed formats; anything that is not a chart gives an empty list. */
export function parseAppleChart(json: unknown): ChartEntry[] {
  const feed = obj(obj(json)?.feed);
  if (!feed) return [];
  const out: ChartEntry[] = [];
  const push = (title: string, artist: string, artworkUrl?: string, appleUrl?: string) => {
    if (!title) return;
    out.push({ rank: out.length + 1, title, artist, ...(artworkUrl ? { artworkUrl: bigger(artworkUrl) } : {}), ...(appleUrl ? { appleUrl } : {}) });
  };

  // current format: feed.results[]
  if (Array.isArray(feed.results)) {
    for (const r of feed.results) {
      const o = obj(r);
      if (o) push(str(o.name), str(o.artistName), str(o.artworkUrl100) || undefined, str(o.url) || undefined);
    }
    if (out.length) return out;
  }
  // old iTunes format: feed.entry[] (a single entry is an object, not a list)
  const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
  for (const e of entries) {
    const o = obj(e);
    if (!o) continue;
    const images = Array.isArray(o['im:image']) ? o['im:image'] : [];
    const lastImage = obj(images[images.length - 1]);
    const href = str(obj(obj(o.link)?.attributes)?.href);
    push(str(obj(o['im:name'])?.label), str(obj(o['im:artist'])?.label), str(lastImage?.label) || undefined, href || undefined);
  }
  return out;
}

/** tries each URL in turn; the first one that really contains a chart wins */
export async function fetchChart(country: string, limit: number, getJson: (url: string) => Promise<unknown>): Promise<ChartEntry[]> {
  const problems: string[] = [];
  for (const url of chartUrls(country, limit)) {
    try {
      const entries = parseAppleChart(await getJson(url));
      if (entries.length) return entries.slice(0, bucketLimit(limit));
      problems.push('中身が空でした');
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`ランキングを取得できませんでした（${problems.join(' / ')}）`);
}

/** the match is used when it is sure, or when the title is right and only the artist is written differently */
export function acceptMatch(r: MatchResult): SongItem | undefined {
  if (r.status === 'matched') return r.best;
  if (r.status === 'maybe' && (r.candidates[0]?.titleScore ?? 0) >= 0.7) return r.best;
  return undefined;
}

export const entryKey = (e: { title: string; artist: string }): string => `${e.title.trim().toLowerCase()}\u0000${e.artist.trim().toLowerCase()}`;

export const isFresh = (c: TrendCache | null, country: string, limit: number, now: number): c is TrendCache =>
  !!c && c.country === cleanCountry(country) && c.limit >= limit && c.entries.length > 0 && now - c.fetchedAt < CHART_TTL_MS && now >= c.fetchedAt;

export interface TrendingDeps {
  getJson: (url: string) => Promise<unknown>;
  search: SearchFn;
  readCache: () => TrendCache | null;
  writeCache: (c: TrendCache) => void;
  now: () => number;
}

export interface TrendingProgress {
  done: number;
  total: number;
}

/**
 * Loads the chart and finds each song. Shows what it knows at once (the cache, then the chart), then fills in the songs one
 * by one. A song matched before is never searched again. If the chart cannot be fetched the old one stays and the error is thrown.
 */
export async function loadTrending(
  opts: { country: string; limit: number; force?: boolean; isCancelled?: () => boolean },
  deps: TrendingDeps,
  onUpdate: (entries: TrendEntry[], progress: TrendingProgress) => void,
): Promise<TrendEntry[]> {
  const country = cleanCountry(opts.country);
  const limit = bucketLimit(opts.limit);
  const isCancelled = opts.isCancelled ?? (() => false);
  const cache = deps.readCache();
  const now = deps.now();
  const sameCountry = cache && cache.country === country ? cache : null;

  let entries: TrendEntry[];
  let fetchedAt = now;
  if (!opts.force && isFresh(cache, country, limit, now)) {
    entries = cache.entries.slice(0, limit);
    fetchedAt = cache.fetchedAt;
  } else {
    let chart: ChartEntry[];
    try {
      chart = await fetchChart(country, limit, deps.getJson);
    } catch (e) {
      if (sameCountry) onUpdate(sameCountry.entries.slice(0, limit), { done: 0, total: 0 }); // the old chart is better than nothing
      throw e;
    }
    const known = new Map<string, TrendEntry>();
    for (const old of sameCountry?.entries ?? []) if (old.status === 'matched' && old.song) known.set(entryKey(old), old);
    entries = chart.map((c): TrendEntry => {
      const old = known.get(entryKey(c));
      return old?.song ? { ...c, status: 'matched', song: old.song } : { ...c, status: 'pending' };
    });
  }

  const total = entries.length;
  const pending = entries.filter((e) => e.status === 'pending');
  const reused = total - pending.length;
  const save = () => deps.writeCache({ v: 1, country, limit, fetchedAt, entries: entries.map((e) => ({ ...e })) });
  onUpdate(entries.map((e) => ({ ...e })), { done: reused, total });
  if (!pending.length) {
    save();
    return entries;
  }

  const tracks: ImportTrack[] = pending.map((e) => ({ title: e.title, artist: e.artist, raw: String(e.rank) }));
  let matchedSinceSave = 0;
  await matchAll(tracks, deps.search, {
    concurrency: 3,
    delayMs: 100,
    isCancelled,
    onProgress: (done, _t, res) => {
      const e = entries.find((x) => String(x.rank) === res.track.raw);
      if (!e) return;
      const song = acceptMatch(res);
      e.status = song ? 'matched' : 'none';
      e.song = song;
      if (isCancelled()) return;
      onUpdate(entries.map((x) => ({ ...x })), { done: reused + done, total });
      if (++matchedSinceSave >= 10) {
        matchedSinceSave = 0;
        save(); // so that an app that is closed halfway keeps what was found
      }
    },
  });
  if (!isCancelled()) save();
  return entries;
}
