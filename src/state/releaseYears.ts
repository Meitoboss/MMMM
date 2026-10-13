import { create } from 'zustand';

import { yt } from '../core';
import { type EnrichResult, enrichYears } from '../core/releaseYears';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

/**
 * Looks up the release year of the albums in the Library (needed for "リリース順"). One run at a time; it can be cancelled; what was
 * found stays. It needs the network, and says so.
 */
interface YearsStore {
  running: boolean;
  done: number;
  total: number;
  cancelRequested: boolean;
  /** the result of the last run, in words */
  message: string;
  /** bumps when something was saved, so that the lists reload */
  version: number;
  start: () => Promise<void>;
  cancel: () => void;
}

export function resultText(r: EnrichResult): string {
  const parts = [`発売年が分かった: ${r.found}件`];
  if (r.none) parts.push(`年の記載がなかった: ${r.none}件`);
  if (r.failed) parts.push(`調べられなかった: ${r.failed}件`);
  if (r.stopped === 'network') return `通信がうまくいかないため、途中でやめました（${parts.join(' / ')}）`;
  if (r.stopped === 'cancelled') return `中止しました（${parts.join(' / ')}）`;
  return `調べました（${parts.join(' / ')}）`;
}

/** how the year of one album is found out (the album page of YouTube Music); tests give another */
type YearFetcher = (albumId: string) => Promise<string | null>;
const defaultFetcher: YearFetcher = async (id) => (await yt.album(id)).year ?? null;
let fetcher: YearFetcher = defaultFetcher;
export function setYearFetcher(f: YearFetcher | null): void {
  fetcher = f ?? defaultFetcher;
}

export const useReleaseYears = create<YearsStore>((set, get) => ({
  running: false,
  done: 0,
  total: 0,
  cancelRequested: false,
  message: '',
  version: 0,
  cancel: () => get().running && set({ cancelRequested: true }),
  start: async () => {
    if (get().running) return;
    set({ running: true, done: 0, total: 0, cancelRequested: false, message: '' });
    try {
      const db = await openDb();
      const ids = await repo.albumsMissingYear(db);
      set({ total: ids.length });
      const res = await enrichYears({
        ids,
        fetchYear: (id) => fetcher(id),
        save: async (id, year) => {
          await repo.setAlbumYear(db, id, year);
        },
        isCancelled: () => get().cancelRequested,
        onProgress: (done, total) => set({ done, total }),
      });
      set({ message: ids.length ? resultText(res) : '調べるアルバムは、ありません', version: get().version + 1 });
    } catch (e) {
      set({ message: `調べられませんでした（${e instanceof Error ? e.message : String(e)}）` });
    } finally {
      set({ running: false, cancelRequested: false });
    }
  },
}));
