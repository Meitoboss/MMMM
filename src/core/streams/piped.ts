import { DEFAULT_PIPED_INSTANCES } from '../config';
import type { AudioSource } from '../types';
import { expiryFromUrl, fetchJson, isIosPlayable } from './util';

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

export async function audioStreams(apiBase: string, videoId: string): Promise<PipedStreams> {
  return fetchJson<PipedStreams>(`${apiBase.replace(/\/$/, '')}/streams/${videoId}`);
}

export function pickAudio(streams: PipedAudioStream[], iosOnly = true): AudioSource | null {
  const audio = streams.filter((s) => !s.videoOnly && (!s.mimeType || s.mimeType.startsWith('audio/')));
  const candidates = iosOnly ? audio.filter((s) => isIosPlayable(s.mimeType)) : audio;
  const best = [...candidates].sort((a, b) => b.bitrate - a.bitrate)[0];
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

export async function resolve(videoId: string, instances: string[] = DEFAULT_PIPED_INSTANCES): Promise<AudioSource> {
  let lastError: unknown;
  for (const base of instances) {
    try {
      const s = await audioStreams(base, videoId);
      const src = pickAudio(s.audioStreams ?? []);
      if (src) return src;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Piped: no playable audio stream (${String(lastError ?? 'no instance answered')})`);
}
