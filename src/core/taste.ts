import { isLocalId } from './localMeta';
import type { SongItem } from './types';

/**
 * "よく聴く曲からのおすすめ": the radios of the most played songs, mixed. Pure logic.
 */
/** how many of the most played songs are the seeds */
export const TASTE_SEEDS = 5;
/** how many songs the mix holds */
export const TASTE_LIMIT = 30;
/** the saved mix is used for this long, then it is made again */
export const TASTE_MAX_AGE_MS = 24 * 3_600_000;

/**
 * The radios of the seed songs, mixed: one song from each radio in turn. No song twice, no seed song, no song on the phone.
 */
export function mixRadios(seedIds: string[], radios: SongItem[][], limit = TASTE_LIMIT): SongItem[] {
  const seen = new Set(seedIds);
  const out: SongItem[] = [];
  const longest = Math.max(0, ...radios.map((r) => r.length));
  for (let i = 0; i < longest && out.length < limit; i++) {
    for (const list of radios) {
      const song = list[i];
      if (!song || seen.has(song.id) || isLocalId(song.id)) continue;
      seen.add(song.id);
      out.push(song);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * A larger version of a Google-hosted cover: the "=w120-h120" part sets the size. Other addresses are returned unchanged.
 */
export function hiResCover(url: string | undefined, px: number): string | undefined {
  if (!url) return url;
  return url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`);
}

/** a saved mix is still used: it was made less than TASTE_MAX_AGE_MS ago (and not in the future) */
export const isFresh = (savedAt: number, now: number): boolean => now >= savedAt && now - savedAt < TASTE_MAX_AGE_MS;
