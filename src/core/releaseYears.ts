/**
 * Finding out the release year of albums (the Library has the album of a song, but not its year until the album page was opened).
 * Pure logic with the network and the database passed in, so that it can be tested.
 */
export const NO_YEAR = ''; // stored for an album that has no year, so that it is not asked about again

/** "2019", "2019-05-01", "May 2019" → "2019"; nothing that looks like a year → null */
export function cleanYear(v: unknown): string | null {
  const m = typeof v === 'string' ? /\b(19\d{2}|20\d{2})\b/.exec(v) : null;
  return m ? m[1] : null;
}

export interface EnrichOptions {
  ids: string[];
  /** the year of an album: a string, null when the album has none; it throws when the network fails */
  fetchYear(id: string): Promise<string | null>;
  save(id: string, year: string): Promise<void>;
  isCancelled(): boolean;
  onProgress?(done: number, total: number): void;
  /** albums asked about at the same time */
  concurrency?: number;
  /** stop after this many failures in a row (the network is down) */
  maxFailuresInRow?: number;
}

export interface EnrichResult {
  found: number;
  none: number;
  failed: number;
  stopped: 'done' | 'cancelled' | 'network';
}

export async function enrichYears(o: EnrichOptions): Promise<EnrichResult> {
  const total = o.ids.length;
  const concurrency = Math.max(1, o.concurrency ?? 3);
  const maxRow = o.maxFailuresInRow ?? 5;
  const r: EnrichResult = { found: 0, none: 0, failed: 0, stopped: 'done' };
  let next = 0;
  let done = 0;
  let inRow = 0;
  let stop: EnrichResult['stopped'] | null = null;

  const worker = async () => {
    for (;;) {
      if (stop) return;
      if (o.isCancelled()) {
        stop = 'cancelled';
        return;
      }
      const i = next++;
      if (i >= total) return;
      const id = o.ids[i];
      try {
        const year = cleanYear(await o.fetchYear(id));
        await o.save(id, year ?? NO_YEAR);
        if (year) r.found++;
        else r.none++;
        inRow = 0;
      } catch {
        r.failed++;
        if (++inRow >= maxRow) stop = 'network';
      }
      o.onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(total, 1)) }, worker));
  r.stopped = stop ?? 'done';
  return r;
}
