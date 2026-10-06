import { DEFAULT_PIPED_INSTANCES, getConfig } from '../config';
import type { AudioSource } from '../types';
import { chooseByQuality } from './quality';
import { expiryFromUrl, fetchJson, firstSuccess } from './util';

/** Port of extensions/piped/.../Piped.kt (`Piped.media.audioStreams` + `PipedResponse`). */
export interface PipedAudioStream {
  itag: number;
  url: string;
  bitrate: number;
  format?: string;
  quality?: string;
  mimeType?: string;
  codec?: string;
  videoOnly?: boolean;
  contentLength?: number;
}

export interface PipedStreams {
  audioStreams: PipedAudioStream[];
  duration?: number;
  title?: string;
  uploader?: string;
  thumbnailUrl?: string;
}

export async function getInstances(): Promise<{ name: string; api_url: string }[]> {
  return fetchJson('https://piped-instances.kavin.rocks/');
}

export async function audioStreams(apiBase: string, videoId: string, timeoutMs = 6000): Promise<PipedStreams> {
  return fetchJson<PipedStreams>(`${apiBase.replace(/\/$/, '')}/streams/${videoId}`, {}, timeoutMs);
}

export function pickAudio(streams: PipedAudioStream[], iosOnly = true): AudioSource | null {
  const audio = streams.filter((s) => !s.videoOnly && (!s.mimeType || s.mimeType.startsWith('audio/')));
  const { quality, platform } = getConfig();
  // iosOnly = "only what this phone can play"; without it any audio counts
  const best = chooseByQuality(audio, quality, iosOnly ? platform : 'android');
  if (!best) return null;
  return {
    url: best.url,
    mimeType: best.mimeType,
    bitrate: best.bitrate,
    itag: best.itag,
    contentLength: best.contentLength,
    via: 'piped',
    expiresAt: expiryFromUrl(best.url),
  };
}

/** All instances are asked in parallel (public instances are slow / often dead). */
export function resolve(videoId: string, instances: string[] = DEFAULT_PIPED_INSTANCES): Promise<AudioSource> {
  return firstSuccess(
    instances.map(async (base) => {
      const src = pickAudio((await audioStreams(base, videoId, 5000)).audioStreams ?? []);
      if (!src) throw new Error('no playable audio stream');
      return src;
    }),
    'Piped',
  );
}
