import { getConfig } from '../config';

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** iOS (AVPlayer) plays AAC in MP4/M4A but not WebM/Opus. */
export function isIosPlayable(mime?: string): boolean {
  return !!mime && /audio\/(mp4|m4a|mpeg|aac)/i.test(mime);
}

/** Can a player of this platform play it? Android (ExoPlayer) also takes WebM/Opus and friends. */
export function playableOn(platform: 'ios' | 'android', mime?: string): boolean {
  if (!mime) return false;
  return platform === 'android' ? mime.startsWith('audio/') : isIosPlayable(mime);
}

/** Can THIS platform's player play it? */
export function isPlayableMime(mime?: string): boolean {
  return playableOn(getConfig().platform, mime);
}

export function expiryFromUrl(url: string): number | undefined {
  const m = url.match(/[?&]expire=(\d+)/);
  return m ? parseInt(m[1], 10) * 1000 : undefined;
}

/** Like Promise.any, without relying on AggregateError support. Rejects with a short summary. */
export function firstSuccess<T>(tasks: Promise<T>[], label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let failed = 0;
    const reasons = new Set<string>();
    if (tasks.length === 0) return reject(new Error(`${label}: no instances configured`));
    for (const t of tasks) {
      t.then(resolve, (e) => {
        reasons.add(e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e));
        if (++failed === tasks.length) reject(new Error(`${label}: all ${tasks.length} instances failed (${[...reasons].slice(0, 3).join('; ')})`));
      });
    }
  });
}
