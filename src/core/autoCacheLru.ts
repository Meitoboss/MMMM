/**
 * The songs kept on the phone by themselves (the auto cache): which ones make room when the cache is full.
 * Pure logic, so it can be tested.
 */
export interface CacheEntry {
  id: string;
  file: string;
  bytes: number;
  /** when it was last played (ms) */
  at: number;
}

/** the entries to delete, oldest first, so that what is left fits both limits */
export function pickEvictions(entries: CacheEntry[], maxBytes: number, maxItems: number): CacheEntry[] {
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  let count = entries.length;
  const out: CacheEntry[] = [];
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    if (total <= maxBytes && count <= maxItems) break;
    out.push(e);
    total -= e.bytes;
    count -= 1;
  }
  return out;
}
