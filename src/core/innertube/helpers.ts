import type { Thumbnail } from '../types';

/** InnerTube responses are huge, loosely typed JSON – we navigate them defensively. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface Run {
  text?: string;
  navigationEndpoint?: Json;
}

/** Runs.text */
export function runsText(runs?: Run[] | { runs?: Run[] } | null): string {
  const list = Array.isArray(runs) ? runs : runs?.runs ?? [];
  return list.map((r) => r.text ?? '').join('');
}

export const SEPARATOR = ' • ';

/** `List<Run>.splitBySeparator()` from Runs.kt */
export function splitBySeparator(runs: Run[] = []): Run[][] {
  const res: Run[][] = [];
  let tmp: Run[] = [];
  for (const run of runs) {
    if (run.text === SEPARATOR) {
      res.push(tmp);
      tmp = [];
    } else {
      tmp.push(run);
    }
  }
  res.push(tmp);
  return res;
}

/** `Environment.getBestQuality()` – the thumbnail with the biggest area. */
export function bestThumbnail(thumbs?: Thumbnail[] | null): string | undefined {
  if (!thumbs || thumbs.length === 0) return undefined;
  let best = thumbs[thumbs.length - 1];
  let bestArea = -1;
  for (const t of thumbs) {
    const area = (t.width ?? 0) * (t.height ?? 0);
    if (area > bestArea) {
      bestArea = area;
      best = t;
    }
  }
  return best.url;
}

export function pageTypeOf(endpoint?: Json): string | undefined {
  return endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
    ?.pageType;
}

export function isArtistEndpoint(endpoint?: Json): boolean {
  const pt = pageTypeOf(endpoint);
  if (pt) return pt === 'MUSIC_PAGE_TYPE_ARTIST' || pt === 'MUSIC_PAGE_TYPE_USER_CHANNEL';
  const id: string | undefined = endpoint?.browseEndpoint?.browseId;
  return !!id && (id.startsWith('UC') || id.startsWith('MPLA'));
}

export function isAlbumEndpoint(endpoint?: Json): boolean {
  const pt = pageTypeOf(endpoint);
  if (pt) return pt === 'MUSIC_PAGE_TYPE_ALBUM' || pt === 'MUSIC_PAGE_TYPE_AUDIOBOOK';
  const id: string | undefined = endpoint?.browseEndpoint?.browseId;
  return !!id && id.startsWith('MPREb');
}

export function isPlaylistEndpoint(endpoint?: Json): boolean {
  const pt = pageTypeOf(endpoint);
  if (pt) return pt === 'MUSIC_PAGE_TYPE_PLAYLIST';
  const id: string | undefined = endpoint?.browseEndpoint?.browseId;
  return !!id && id.startsWith('VL');
}

/** "3:45" -> 225, "1:02:03" -> 3723 */
export function parseDuration(text?: string): number | undefined {
  if (!text) return undefined;
  const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

export const DURATION_RE = /^(?:\d+:)?\d{1,2}:\d{2}$/;

export function firstDefined<T>(...values: (T | undefined | null)[]): T | undefined {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

/** `continuations[0].nextContinuationData.continuation` or a trailing `continuationItemRenderer` */
export function findContinuation(node: Json): string | undefined {
  const fromData = node?.continuations?.[0]?.nextContinuationData?.continuation;
  if (fromData) return fromData;
  const contents: Json[] | undefined = node?.contents ?? node?.continuationItems;
  const last = contents?.[contents.length - 1];
  return last?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ?? undefined;
}
