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

export function expiryFromUrl(url: string): number | undefined {
  const m = url.match(/[?&]expire=(\d+)/);
  return m ? parseInt(m[1], 10) * 1000 : undefined;
}
