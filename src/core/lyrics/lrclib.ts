import type { Lyrics } from '../types';
import { parseLrc } from './lrc';

/** Port of extensions/lrclib/.../LrcLib.kt (https://lrclib.net/docs) */
interface LrcLibTrack {
  id: number;
  name?: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number | number[];
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const BASE = 'https://lrclib.net';

/** `Track.duration` – LRCLIB sometimes returns a number, the Kotlin code also tolerated arrays. */
function durationOf(t: LrcLibTrack): number {
  const d = Array.isArray(t.duration) ? t.duration[0] : t.duration;
  return Math.floor(Number(d));
}

export async function searchTracks(artist: string, title: string, album?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) params.set('album_name', album);
  const res = await fetch(`${BASE}/api/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
  return (await res.json()) as LrcLibTrack[];
}

/** `bestMatchingFor` – exact duration match, otherwise the closest title length. */
function bestMatch(tracks: LrcLibTrack[], title: string, durationSec?: number): LrcLibTrack | undefined {
  if (tracks.length === 0) return undefined;
  if (durationSec !== undefined) {
    const exact = tracks.find((t) => Math.abs(durationOf(t) - durationSec) <= 1);
    if (exact) return exact;
  }
  return [...tracks].sort(
    (a, b) => Math.abs(a.trackName.length - title.length) - Math.abs(b.trackName.length - title.length),
  )[0];
}

export async function getLyrics(
  artist: string,
  title: string,
  durationSec?: number,
  album?: string,
  signal?: AbortSignal,
): Promise<Lyrics | null> {
  const tracks = await searchTracks(artist, title, album, signal);
  const synced = tracks.filter((t) => !!t.syncedLyrics);
  const pick = bestMatch(synced.length ? synced : tracks, title, durationSec);
  if (!pick) return null;
  if (pick.syncedLyrics) {
    return { source: 'lrclib', synced: true, lines: parseLrc(pick.syncedLyrics), plain: pick.plainLyrics ?? undefined };
  }
  if (pick.plainLyrics) {
    return {
      source: 'lrclib',
      synced: false,
      lines: pick.plainLyrics.split(/\r?\n/).map((text) => ({ time: 0, text })),
      plain: pick.plainLyrics,
    };
  }
  return null;
}
