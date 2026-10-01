import type { Lyrics } from '../types';
import { base64ToUtf8 } from './base64';
import { normalizeKuGou, parseLrc } from './lrc';

/** Port of extensions/kugou/.../KuGou.kt */
interface Candidate {
  id: number;
  accesskey: string;
  duration: number;
}
interface SongInfo {
  duration: number;
  hash: string;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`KuGou HTTP ${res.status}`);
  // KuGou answers with text/html or text/plain content-types, so parse manually (like the Kotlin json(feature, Html/Plain))
  return JSON.parse(await res.text()) as T;
}

const enc = (s: string) => encodeURIComponent(s); // spaceToPlus = false -> %20

/** `extract(" (feat. ", ')')` helper */
function extract(s: string, start: string, end: string): [string, string] {
  const i = s.indexOf(start);
  if (i === -1) return [s, ''];
  const j = s.indexOf(end, i);
  if (j === -1) return [s, ''];
  return [s.slice(0, i) + s.slice(j + 1), s.slice(i + start.length, j)];
}

export function keyword(artist: string, title: string): string {
  const [newTitle, featuring] = extract(title, ' (feat. ', ')');
  const newArtist = (featuring ? `${artist}, ${featuring}` : artist)
    .replace(/, /g, '、')
    .replace(/ & /g, '、')
    .replace(/\./g, '');
  return `${newArtist} - ${newTitle}`;
}

async function searchSong(kw: string, signal?: AbortSignal): Promise<SongInfo[]> {
  const r = await getJson<{ data: { info: SongInfo[] } }>(
    `https://mobileservice.kugou.com/api/v3/search/song?version=9108&plat=0&pagesize=8&showtype=0&keyword=${enc(kw)}`,
    signal,
  );
  return r.data?.info ?? [];
}

async function searchLyricsByHash(hash: string, signal?: AbortSignal): Promise<Candidate[]> {
  const r = await getJson<{ candidates: Candidate[] }>(
    `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&hash=${enc(hash)}`,
    signal,
  );
  return r.candidates ?? [];
}

async function searchLyricsByKeyword(kw: string, signal?: AbortSignal): Promise<Candidate[]> {
  const r = await getJson<{ candidates: Candidate[] }>(
    `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${enc(kw)}`,
    signal,
  );
  return r.candidates ?? [];
}

async function download(c: Candidate, signal?: AbortSignal): Promise<string> {
  const r = await getJson<{ content: string }>(
    `https://krcs.kugou.com/download?ver=1&man=yes&client=pc&fmt=lrc&id=${c.id}&accesskey=${enc(c.accesskey)}`,
    signal,
  );
  return normalizeKuGou(base64ToUtf8(r.content));
}

function toLyrics(text: string): Lyrics {
  return { source: 'kugou', synced: true, lines: parseLrc(text), plain: undefined };
}

export async function getLyrics(
  artist: string,
  title: string,
  durationSec: number,
  signal?: AbortSignal,
): Promise<Lyrics | null> {
  const kw = keyword(artist, title);
  const songs = await searchSong(kw, signal);

  if (songs.length > 0) {
    for (let tolerance = 0; tolerance <= 5; tolerance++) {
      for (const info of songs) {
        if (info.duration >= durationSec - tolerance && info.duration <= durationSec + tolerance) {
          const cand = (await searchLyricsByHash(info.hash, signal))[0];
          if (cand) return toLyrics(await download(cand, signal));
        }
      }
    }
  }
  const cand = (await searchLyricsByKeyword(kw, signal))[0];
  return cand ? toLyrics(await download(cand, signal)) : null;
}
