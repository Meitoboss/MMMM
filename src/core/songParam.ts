import type { SongItem } from './types';

/**
 * Screens opened from a song's menu get the song as a route parameter (a string). Only what a screen needs is passed,
 * and what comes back is checked – a link can be anything.
 */
export function encodeSong(song: SongItem): string {
  return JSON.stringify({
    kind: 'song',
    id: song.id,
    title: song.title,
    artists: song.artists,
    album: song.album,
    durationText: song.durationText,
    durationSec: song.durationSec,
    thumbnail: song.thumbnail,
    explicit: song.explicit,
  });
}

export function decodeSong(raw: string | string[] | undefined): SongItem | null {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Partial<SongItem> | null;
    if (!s || s.kind !== 'song' || typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' || !Array.isArray(s.artists)) return null;
    return { ...(s as SongItem), explicit: s.explicit === true };
  } catch {
    return null;
  }
}
