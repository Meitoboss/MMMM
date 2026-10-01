import type { AudioSource } from '../types';

/**
 * Client for server/server.mjs (the yt-dlp helper you run yourself).
 * GET {base}/resolve?v=ID  ->  { path, mimeType, size }   (the server downloads + caches the audio)
 */
export async function resolve(videoId: string, baseUrl: string, key?: string, timeoutMs = 90_000): Promise<AudioSource> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Stream server URL must start with http:// or https://');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const q = new URLSearchParams({ v: videoId });
    if (key) q.set('key', key);
    const res = await fetch(`${base}/resolve?${q.toString()}`, { signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as { path?: string; mimeType?: string; size?: number; error?: string };
    if (!res.ok || !body.path) throw new Error(body.error ?? `server answered HTTP ${res.status}`);
    return { url: `${base}${body.path}`, mimeType: body.mimeType, contentLength: body.size, via: 'server' };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`server did not answer within ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
