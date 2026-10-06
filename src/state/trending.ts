import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { yt } from '../core';
import { fetchJson } from '../core/streams/util';
import { type TrendCache, type TrendEntry, type TrendingProgress, cleanCountry, loadTrending } from '../core/trending';
import { useSettings } from './settings';

const KEY = 'trending.cache.v1';

function readCache(): TrendCache | null {
  try {
    const raw = Storage.getItemSync(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as TrendCache;
    return c && c.v === 1 && typeof c.country === 'string' && typeof c.limit === 'number' && typeof c.fetchedAt === 'number' && Array.isArray(c.entries) ? c : null;
  } catch {
    return null; // a damaged cache is just no cache
  }
}

function writeCache(c: TrendCache): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(c));
  } catch {
    /* the chart still works, it is only fetched again next time */
  }
}

interface TrendingState {
  entries: TrendEntry[];
  /** songs found so far while the chart is being matched */
  progress: TrendingProgress | null;
  loading: boolean;
  error?: string;
  load: (force?: boolean) => Promise<void>;
  setCountry: (code: string) => void;
  setLimit: (n: number) => void;
}

let token = 0; // a newer load makes an older one stop

export const useTrending = create<TrendingState>((set, get) => ({
  entries: [],
  progress: null,
  loading: false,
  load: async (force = false) => {
    const { trendingCountry, trendingLimit } = useSettings.getState();
    const my = ++token;
    set({ loading: true, error: undefined });
    try {
      await loadTrending(
        { country: cleanCountry(trendingCountry), limit: trendingLimit, force, isCancelled: () => my !== token },
        {
          getJson: (u) => fetchJson<unknown>(u, {}, 8000),
          search: async (q) => (await yt.search(q, 'song')).items,
          readCache,
          writeCache,
          now: Date.now,
        },
        (entries, progress) => {
          if (my === token) set({ entries, progress });
        },
      );
      if (my === token) set({ loading: false, progress: null });
    } catch (e) {
      if (my === token) set({ loading: false, progress: null, error: e instanceof Error ? e.message : String(e) });
    }
  },
  setCountry: (code) => {
    useSettings.getState().update({ trendingCountry: cleanCountry(code) });
    set({ entries: [] }); // the other country's songs must not stay on screen
    void get().load();
  },
  setLimit: (n) => {
    useSettings.getState().update({ trendingLimit: n });
    void get().load();
  },
}));
