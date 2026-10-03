import type { MusicItem, SongItem } from './types';

/**
 * Playlist import: a list of tracks (CSV exported from another service, or plain text lines) is matched, one by one,
 * against YouTube Music's search. Nothing is fetched from the other service – the list comes from the user.
 * Written without regular expressions: only plain string handling.
 */
export interface ImportTrack {
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  /** the original text, for display */
  raw: string;
  /** plain-text lines: "A - B" may be "artist - title" or "title - artist" */
  swapOk?: boolean;
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

/** Minimal CSV reader: quotes, escaped quotes (""), commas / tabs / semicolons, newlines inside quotes, BOM. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? '';
  const counts: [string, number][] = [',', '\t', ';'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

const TITLE_NAMES = ['track name', 'track', 'title', 'name', 'song', 'song name', 'track title', '曲名', '曲', 'タイトル', 'トラック名', 'トラック'];
const ARTIST_NAMES = ['artist name(s)', 'artist name', 'artist names', 'artists', 'artist', 'アーティスト', 'アーティスト名'];
const ALBUM_NAMES = ['album name', 'album', 'アルバム', 'アルバム名'];
const DURATION_NAMES = ['duration (ms)', 'duration_ms', 'duration ms', 'duration', 'length', 'time', '時間', '再生時間'];

function findColumn(header: string[], names: string[]): number {
  const h = header.map((x) => x.trim().toLowerCase());
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** "225000" (ms), "225" (s), "3:45", "1:02:03" → seconds */
export function parseDurationValue(value: string, headerSaysMs = false): number | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (v.includes(':')) {
    const parts = v.split(':').map((p) => Number(p));
    if (parts.some((p) => !Number.isFinite(p))) return undefined;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return headerSaysMs || n > 3000 ? Math.round(n / 1000) : Math.round(n);
}

/* ------------------------------------------------------------------ *
 * reading a pasted list
 * ------------------------------------------------------------------ */

const SEPARATORS = [' - ', ' – ', ' — ', ' | ', '\t'];

/** "1. Title" / "02) Title" → "Title"  (a title that merely starts with digits is left alone) */
function stripNumbering(line: string): string {
  let i = 0;
  while (i < line.length && line[i] >= '0' && line[i] <= '9') i++;
  if (i === 0 || i > 3) return line;
  const mark = line[i];
  if ((mark === '.' || mark === ')' || mark === '、') && line[i + 1] === ' ') return line.slice(i + 2).trim();
  return line;
}

function parseLines(text: string): ImportTrack[] {
  const out: ImportTrack[] = [];
  for (const rawLine of text.split('\n')) {
    const line = stripNumbering(rawLine.trim());
    if (!line || line.startsWith('#')) continue;
    let done = false;
    for (const sep of SEPARATORS) {
      const at = line.indexOf(sep);
      if (at > 0) {
        const left = line.slice(0, at).trim();
        const right = line.slice(at + sep.length).trim();
        if (left && right) {
          out.push({ title: left, artist: right, raw: line, swapOk: true });
          done = true;
          break;
        }
      }
    }
    if (!done) out.push({ title: line, raw: line });
  }
  return out;
}

/**
 * CSV with a header row (Exportify, TuneMyMusic and similar exports) or plain lines such as
 * "Artist - Title". Duplicates are dropped.
 */
export function parseTrackList(text: string): ImportTrack[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let tracks: ImportTrack[] | null = null;

  const rows = parseCsv(trimmed);
  if (rows.length >= 1) {
    const header = rows[0];
    const titleCol = findColumn(header, TITLE_NAMES);
    const artistCol = findColumn(header, ARTIST_NAMES);
    if (titleCol >= 0 && (artistCol >= 0 || header.length > 1)) {
      const albumCol = findColumn(header, ALBUM_NAMES);
      const durCol = findColumn(header, DURATION_NAMES);
      const msHeader = durCol >= 0 && header[durCol].toLowerCase().includes('ms');
      tracks = [];
      for (const r of rows.slice(1)) {
        const title = (r[titleCol] ?? '').trim();
        if (!title) continue;
        const artist = artistCol >= 0 ? (r[artistCol] ?? '').trim() : '';
        tracks.push({
          title,
          artist: artist || undefined,
          album: albumCol >= 0 ? (r[albumCol] ?? '').trim() || undefined : undefined,
          durationSec: durCol >= 0 ? parseDurationValue(r[durCol] ?? '', msHeader) : undefined,
          raw: artist ? `${title} – ${artist}` : title,
        });
      }
    }
  }
  const list = tracks ?? parseLines(trimmed);

  const seen = new Set<string>();
  return list.filter((t) => {
    const key = `${normalize(t.title)}|${normalize(t.artist ?? '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * comparing text
 * ------------------------------------------------------------------ */

const PUNCT = '・、。，．：；！？「」『』（）［］｛｝【】〈〉《》～〜―—–‐\u3000';
const NOISE = new Set(['feat', 'ft', 'featuring', 'remastered', 'remaster', 'official', 'video', 'audio', 'mv', 'lyric', 'lyrics', 'explicit', 'topic']);

const isWordChar = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) return true; // 0-9 a-z
  if (c < 128) return false;
  return !PUNCT.includes(ch);
};

/** removes (…) [...] 【…】 and their content, unless that would leave nothing */
function stripBrackets(s: string): string {
  const open = '([（［【';
  const close = ')]）］】';
  let depth = 0;
  let out = '';
  for (const ch of s) {
    if (open.includes(ch)) depth += 1;
    else if (close.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out.trim() ? out : s;
}

/** lower case, full-width → half-width, without brackets / punctuation / spaces / noise words ("feat.", "Remastered" …) */
export function normalize(input: string): string {
  let s = input;
  try {
    s = s.normalize('NFKC');
  } catch {
    /* engine without normalize: keep as is */
  }
  s = stripBrackets(s.toLowerCase());
  const words: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (isWordChar(ch)) cur += ch;
    else if (cur) {
      words.push(cur);
      cur = '';
    }
  }
  if (cur) words.push(cur);
  return words.filter((w) => !NOISE.has(w)).join('');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 0 … 1 */
export function textSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 2 && long.includes(short)) return 0.75 + 0.25 * (short.length / long.length);
  if (short.length < 2) return 0;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (Math.max(1, na.length - 1) + Math.max(1, nb.length - 1));
}

const ARTIST_SPLITS = [';', ',', '&', '、', '/', ' feat. ', ' ft. ', ' x ', ' × '];

function artistNames(text: string): string[] {
  let parts = [text];
  for (const sp of ARTIST_SPLITS) parts = parts.flatMap((p) => p.split(sp));
  return [text, ...parts.map((p) => p.trim()).filter(Boolean)];
}

function artistSimilarity(wanted: string, have: string[]): number {
  const names = artistNames(wanted);
  const haveAll = [have.join(' '), ...have];
  let best = 0;
  for (const w of names) for (const h of haveAll) best = Math.max(best, textSimilarity(w, h));
  return best;
}

function durationSimilarity(a?: number, b?: number): number | undefined {
  if (!a || !b) return undefined;
  const d = Math.abs(a - b);
  return d <= 3 ? 1 : d <= 8 ? 0.6 : d <= 20 ? 0.2 : 0;
}

const UNWANTED = ['karaoke', 'instrumental', 'cover', 'tribute', '8d', 'slowed', 'sped up', 'nightcore', 'reverb', 'カラオケ'];

export interface Scored {
  song: SongItem;
  score: number;
  /** how well the title alone matched */
  titleScore: number;
}

export function scoreCandidate(track: ImportTrack, song: SongItem): Scored {
  const haveArtists = song.artists.map((a) => a.name);
  const one = (title: string, artist?: string) => {
    const t = textSimilarity(title, song.title);
    const parts: [number, number][] = [[t, 0.6]];
    if (artist) parts.push([artistSimilarity(artist, haveArtists), 0.3]);
    const d = durationSimilarity(track.durationSec, song.durationSec);
    if (d !== undefined) parts.push([d, 0.1]);
    const weight = parts.reduce((s, [, w]) => s + w, 0);
    return { score: parts.reduce((s, [v, w]) => s + v * w, 0) / weight, titleScore: t };
  };
  let best = one(track.title, track.artist);
  if (track.swapOk && track.artist) {
    const swapped = one(track.artist, track.title);
    if (swapped.score > best.score) best = swapped;
  }
  const wantedText = `${track.title} ${track.artist ?? ''}`.toLowerCase();
  const songText = song.title.toLowerCase();
  const unwanted = UNWANTED.some((w) => songText.includes(w) && !wantedText.includes(w));
  return { song, score: unwanted ? best.score * 0.8 : best.score, titleScore: best.titleScore };
}

/* ------------------------------------------------------------------ *
 * matching against the search
 * ------------------------------------------------------------------ */

export type MatchStatus = 'matched' | 'maybe' | 'none';

export interface MatchResult {
  track: ImportTrack;
  status: MatchStatus;
  best?: SongItem;
  score: number;
  /** best first, at most 5 */
  candidates: Scored[];
  error?: string;
}

export const MATCH_SCORE = 0.75;
export const MAYBE_SCORE = 0.45;

export type SearchFn = (query: string) => Promise<MusicItem[]>;

function classify(best: Scored | undefined): MatchStatus {
  if (!best) return 'none';
  if (best.score >= MATCH_SCORE && best.titleScore >= 0.7) return 'matched';
  return best.score >= MAYBE_SCORE ? 'maybe' : 'none';
}

export async function matchTrack(track: ImportTrack, search: SearchFn): Promise<MatchResult> {
  const queries = [...new Set([`${track.artist ?? ''} ${track.title}`.trim(), track.title])];
  const byId = new Map<string, Scored>();
  let status: MatchStatus = 'none';
  for (const q of queries) {
    const items = await search(q);
    for (const it of items) {
      if (it.kind !== 'song' || byId.has(it.id)) continue;
      byId.set(it.id, scoreCandidate(track, it));
    }
    const ranked = [...byId.values()].sort((a, b) => b.score - a.score);
    status = classify(ranked[0]);
    if (status === 'matched') break; // a sure hit: no second search needed
  }
  const candidates = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  return { track, status, best: candidates[0]?.song, score: candidates[0]?.score ?? 0, candidates };
}

export interface ImportOptions {
  concurrency?: number;
  /** pause before each search, so a long list does not hammer the service */
  delayMs?: number;
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number, result: MatchResult) => void;
}

export async function matchAll(tracks: ImportTrack[], search: SearchFn, opts: ImportOptions = {}): Promise<MatchResult[]> {
  const { concurrency = 3, delayMs = 120, isCancelled = () => false, onProgress } = opts;
  const results: (MatchResult | undefined)[] = new Array(tracks.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      if (isCancelled()) return;
      const i = next++;
      if (i >= tracks.length) return;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      let res: MatchResult;
      try {
        res = await matchTrack(tracks[i], search);
      } catch (e) {
        res = { track: tracks[i], status: 'none', score: 0, candidates: [], error: e instanceof Error ? e.message : String(e) };
      }
      results[i] = res;
      done += 1;
      onProgress?.(done, tracks.length, res);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tracks.length || 1)) }, worker));
  return results.filter((r): r is MatchResult => !!r);
}
