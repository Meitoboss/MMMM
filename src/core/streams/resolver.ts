import { player } from '../innertube/api';
import { resolveWithPoToken } from '../innertube/webpot';
import type { AudioSource } from '../types';
import * as invidious from './invidious';
import * as piped from './piped';
import * as server from './server';
import { getConfig } from '../config';
import { expiryFromUrl } from './util';
import { chooseByQuality } from './quality';

export type StreamBackend = 'server' | 'webpot' | 'innertube' | 'piped' | 'invidious';

export interface ResolverOptions {
  order?: StreamBackend[];
  pipedInstances?: string[];
  invidiousInstances?: string[];
  /** URL of your own server/server.mjs, e.g. http://192.168.1.10:8787 – used first when set */
  serverUrl?: string;
  serverKey?: string;
}

const cache = new Map<string, AudioSource>();

/** InnerTube `player` (iOS client): direct, non-ciphered URLs – no signature deciphering needed. */
async function viaInnerTube(videoId: string): Promise<AudioSource> {
  const r = await player(videoId, 'ios');
  if (r.status && r.status !== 'OK') throw new Error(`InnerTube: ${r.status} ${r.reason ?? ''}`.trim());
  const { quality, platform } = getConfig();
  const best = chooseByQuality(
    r.formats.filter((f) => f.url && f.mimeType.startsWith('audio/')).map((f) => ({ ...f, mimeType: f.mimeType.split(';')[0] })),
    quality,
    platform,
  );
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

  const base: StreamBackend[] = opts.order ?? ['webpot', 'piped', 'invidious'];
  const order: StreamBackend[] = opts.serverUrl?.trim() ? ['server', ...base.filter((b) => b !== 'server')] : base.filter((b) => b !== 'server');
  const errors: string[] = [];
  for (const backend of order) {
    try {
      const src =
        backend === 'server'
          ? await server.resolve(videoId, opts.serverUrl ?? '', opts.serverKey)
          : backend === 'webpot'
            ? await resolveWithPoToken(videoId)
            : backend === 'innertube'
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
