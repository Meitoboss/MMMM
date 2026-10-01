import type { Lyrics } from '../types';
import * as kugou from './kugou';
import * as lrclib from './lrclib';

export { parseLrc, activeLineIndex } from './lrc';
export { lrclib, kugou };

export interface LyricsQuery {
  artist: string;
  title: string;
  durationSec?: number;
  album?: string;
}

/** Tries LRCLIB first (open, no key), then KuGou. Returns null when nothing is found. */
export async function findLyrics(q: LyricsQuery, signal?: AbortSignal): Promise<Lyrics | null> {
  try {
    const l = await lrclib.getLyrics(q.artist, q.title, q.durationSec, q.album, signal);
    if (l && l.lines.length > 1) return l;
  } catch {
    /* fall through to next provider */
  }
  try {
    return await kugou.getLyrics(q.artist, q.title, q.durationSec ?? 0, signal);
  } catch {
    return null;
  }
}
