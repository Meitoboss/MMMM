import { player } from '../innertube/api';
import type { AudioSource } from '../types';
import * as invidious from './invidious';
import * as piped from './piped';
import { expiryFromUrl, isIosPlayable } from './util';

export type StreamBackend = 'innertube' | 'piped' | 'invidious';

export interface ResolverOptions {
  order?: StreamBackend[];
  pipedInstances?: string[];
  invidiousInstances?: string[];
}

const cache = new Map<string, AudioSource>();

/** InnerTube `player` (iOS client): direct, non-ciphered URLs – no signature deciphering needed. */
async function viaInnerTube(videoId: string): Promise<AudioSource> {
  const r = await player(videoId, 'ios');
  if (r.status && r.status !== 'OK') throw new Error(`InnerTube: ${r.status} ${r.reason ?? ''}`.trim());
  const best = r.formats
    .filter((f) => f.url && isIosPlayable(f.mimeType.split(';')[0]) && f.mimeType.startsWith('audio/'))
    .sort((a, b) => b.bitrate - a.bitrate)[0];
  if (!best?.url) throw new Error('InnerTube: no directly playable audio format (ciphered or PO-token protected)');
  return {
    url: best.url,
    mimeType: best.mimeType.split(';')[0],
    bitrate: best.bitrate,
    itag: best.itag,
    contentLength: best.contentLength,
    via: 'innertube',
    expiresAt: expiryFromUrl(best.url) ?? (r.expiresInSeconds ? Date.now() + r.expiresInSeconds * 1000 : undefined),
  };
}

/**
 * Resolve a playable audio URL for a videoId, trying every backend in order.
 * (Kotlin did the same: InnerTube → Piped / Invidious fallbacks.)
 */
export async function resolveAudio(videoId: string, opts: ResolverOptions = {}): Promise<AudioSource> {
  const hit = cache.get(videoId);
  if (hit && (!hit.expiresAt || hit.expiresAt - 60_000 > Date.now())) return hit;

  const order = opts.order ?? ['innertube', 'piped', 'invidious'];
  const errors: string[] = [];
  for (const backend of order) {
    try {
      const src =
        backend === 'innertube'
          ? await viaInnerTube(videoId)
          : backend === 'piped'
            ? await piped.resolve(videoId, opts.pipedInstances)
            : await invidious.resolve(videoId, opts.invidiousInstances);
      cache.set(videoId, src);
      return src;
    } catch (e) {
      errors.push(`${backend}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`Could not resolve a stream for ${videoId}\n${errors.join('\n')}`);
}

export function clearStreamCache() {
  cache.clear();
}
