import Storage from 'expo-sqlite/kv-store';

import { type AppleRelease, appleNewReleasesUrl, parseAppleFeed } from '../core/appleNew';

/** the Apple Music new releases, kept for a while on the phone (so the 新着 tab opens at once) */
const KEY = 'apple.newReleases.v1';
const FRESH_MS = 6 * 60 * 60 * 1000;

interface Saved {
  at: number;
  items: AppleRelease[];
}

function read(): Saved | null {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function write(v: Saved): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(v));
  } catch {
    /* best effort */
  }
}

/** the saved releases (empty until the first load) */
export function cachedAppleReleases(): AppleRelease[] {
  return read()?.items ?? [];
}

/** the releases from Apple, fetched again when the saved ones are old (or when forced); a failed fetch keeps the saved ones */
export async function getAppleReleases(force = false): Promise<AppleRelease[]> {
  const saved = read();
  if (!force && saved && Date.now() - saved.at < FRESH_MS) return saved.items;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(appleNewReleasesUrl('jp', 30), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`${res.status}`);
    const items = parseAppleFeed(await res.json());
    if (items.length) write({ at: Date.now(), items });
    return items.length ? items : (saved?.items ?? []);
  } catch {
    return saved?.items ?? [];
  }
}
