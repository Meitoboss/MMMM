import { DEFAULT_INVIDIOUS_INSTANCES } from '../config';
import type { AudioSource } from '../types';
import { expiryFromUrl, fetchJson, isIosPlayable } from './util';

/** Port of extensions/invidious (`Invidious.api.videos` + `InvidiousResponse`). */
export interface AdaptiveFormat {
  itag?: string;
  url?: string;
  type?: string; // e.g. audio/mp4; codecs="mp4a.40.2"
  bitrate?: string | number;
  clen?: string;
  audioQuality?: string;
}

export async function videos(base: string, videoId: string): Promise<{ adaptiveFormats?: AdaptiveFormat[] }> {
  return fetchJson(`${base.replace(/\/$/, '')}/api/v1/videos/${videoId}`);
}

export async function resolve(videoId: string, instances: string[] = DEFAULT_INVIDIOUS_INSTANCES): Promise<AudioSource> {
  let lastError: unknown;
  for (const base of instances) {
    try {
      const r = await videos(base, videoId);
      const mime = (f: AdaptiveFormat) => f.type?.split(';')[0].trim();
      const best = (r.adaptiveFormats ?? [])
        .filter((f) => f.url && mime(f)?.startsWith('audio/') && isIosPlayable(mime(f)))
        .sort((a, b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0))[0];
      if (best?.url) {
        return {
          url: best.url,
          mimeType: mime(best),
          bitrate: Number(best.bitrate ?? 0),
          itag: best.itag ? Number(best.itag) : undefined,
          contentLength: best.clen ? Number(best.clen) : undefined,
          via: 'invidious',
          expiresAt: expiryFromUrl(best.url),
        };
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Invidious: no playable audio stream (${String(lastError ?? 'no instance answered')})`);
}
