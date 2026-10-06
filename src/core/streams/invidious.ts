import { DEFAULT_INVIDIOUS_INSTANCES, getConfig } from '../config';
import type { AudioSource } from '../types';
import { chooseByQuality } from './quality';
import { expiryFromUrl, fetchJson, firstSuccess } from './util';

/** Port of extensions/invidious (`Invidious.api.videos` + `InvidiousResponse`). */
export interface AdaptiveFormat {
  itag?: string;
  url?: string;
  type?: string; // e.g. audio/mp4; codecs="mp4a.40.2"
  bitrate?: string | number;
  clen?: string;
  audioQuality?: string;
}

export async function videos(base: string, videoId: string, timeoutMs = 6000): Promise<{ adaptiveFormats?: AdaptiveFormat[] }> {
  return fetchJson(`${base.replace(/\/$/, '')}/api/v1/videos/${videoId}`, {}, timeoutMs);
}

export function resolve(videoId: string, instances: string[] = DEFAULT_INVIDIOUS_INSTANCES): Promise<AudioSource> {
  const mime = (f: AdaptiveFormat) => f.type?.split(';')[0].trim();
  return firstSuccess(
    instances.map(async (base) => {
      const r = await videos(base, videoId, 5000);
      const rated = (r.adaptiveFormats ?? [])
        .filter((f) => f.url && mime(f)?.startsWith('audio/'))
        .map((f) => ({ f, bitrate: Number(f.bitrate ?? 0), mimeType: mime(f) }));
      const { quality, platform } = getConfig();
      const best = chooseByQuality(rated, quality, platform)?.f;
      if (!best?.url) throw new Error('no playable audio stream');
      return {
        url: best.url,
        mimeType: mime(best),
        bitrate: Number(best.bitrate ?? 0),
        itag: best.itag ? Number(best.itag) : undefined,
        contentLength: best.clen ? Number(best.clen) : undefined,
        via: 'invidious' as const,
        expiresAt: expiryFromUrl(best.url),
      };
    }),
    'Invidious',
  );
}
