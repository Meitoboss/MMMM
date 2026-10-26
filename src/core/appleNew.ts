/**
 * Apple Music's new releases, from Apple's public chart feed (metadata only: the name, the artist and the picture).
 * The sound is never taken from Apple: a release is looked up on YouTube Music and played from there.
 * Pure logic, so it can be tested.
 */
export interface AppleRelease {
  id: string;
  name: string;
  artist: string;
  /** the picture, at 300 pixels */
  artwork: string;
  /** Apple's own page of the release (shown on the 新着 tab only as a link source; not played) */
  url: string;
}

/** Apple's chart of the top albums in a country (default Japan). The new-releases feed no longer exists (404), so this is the nearest one. */
export const appleNewReleasesUrl = (country = 'jp', limit = 30): string =>
  `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/${limit}/albums.json`;

interface FeedEntry {
  id?: unknown;
  name?: unknown;
  artistName?: unknown;
  artworkUrl100?: unknown;
  url?: unknown;
}

/** the releases in the feed's JSON (anything that is not a release is left out) */
export function parseAppleFeed(json: unknown): AppleRelease[] {
  const results = (json as { feed?: { results?: unknown } } | null)?.feed?.results;
  if (!Array.isArray(results)) return [];
  const out: AppleRelease[] = [];
  for (const entry of results as FeedEntry[]) {
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.artistName !== 'string') continue;
    const art = typeof entry.artworkUrl100 === 'string' ? entry.artworkUrl100.replace('100x100bb', '300x300bb') : '';
    out.push({ id: entry.id, name: entry.name, artist: entry.artistName, artwork: art, url: typeof entry.url === 'string' ? entry.url : '' });
  }
  return out;
}

/** the release that matches a search result's title (case and spacing ignored), or undefined */
export const sameTitle = (a: string, b: string): boolean => {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  return norm(a) === norm(b);
};
