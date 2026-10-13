import { create } from 'zustand';

import { DownloadQueue, type JobState } from '../core/downloadQueue';
import { isLocalId } from '../core/localMeta';
import { runDownload } from '../core/offlineJobs';
import type { SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { offlineDeps, removeAllOfflineCopies, removeOfflineCopy } from '../player/offline';

interface OfflineStore {
  /** songs that have a saved copy */
  ids: Record<string, true>;
  /** queued / running / finished / failed downloads */
  jobs: Record<string, JobState>;
  /** titles of the songs in `jobs`, for the progress list */
  names: Record<string, string>;
  /** changes whenever a download finishes or a copy is removed (lists reload on it) */
  version: number;
  loaded: boolean;
  load: () => Promise<void>;
  /** returns how many songs were actually queued */
  save: (songs: SongItem[]) => number;
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
  remove: (id: string) => Promise<void>;
  removeAll: () => Promise<void>;
}

/** songs waiting for / in a download, so the queue (which only knows ids) can find the song again */
const pending = new Map<string, SongItem>();

export const useOffline = create<OfflineStore>((set, get) => ({
  ids: {},
  jobs: {},
  names: {},
  version: 0,
  loaded: false,

  load: async () => {
    try {
      const ids: Record<string, true> = {};
      for (const id of await repo.offlineIds(await openDb())) ids[id] = true;
      set({ ids, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  save: (songs) => {
    let queued = 0;
    for (const song of songs) {
      if (isLocalId(song.id) || get().ids[song.id]) continue;
      pending.set(song.id, song);
      if (queue.enqueue(song.id)) {
        queued += 1;
        set({ names: { ...get().names, [song.id]: song.title } });
      }
    }
    return queued;
  },

  cancel: (id) => queue.cancel(id),
  dismiss: (id) => queue.clear(id),

  remove: async (id) => {
    await removeOfflineCopy(id);
    const ids = { ...get().ids };
    delete ids[id];
    set({ ids, version: get().version + 1 });
  },

  removeAll: async () => {
    await removeAllOfflineCopies();
    set({ ids: {}, version: get().version + 1 });
  },
}));

const queue = new DownloadQueue(
  async (id, onProgress, isCancelled) => {
    const song = pending.get(id);
    if (!song) throw new Error('曲の情報が見つかりません');
    await runDownload(await openDb(), offlineDeps, song, onProgress, isCancelled);
  },
  (id, state) => {
    const { jobs, ids, version } = useOffline.getState();
    const next = { ...jobs };
    if (state) next[id] = state;
    else delete next[id];

    if (state?.status === 'done') {
      pending.delete(id);
      useOffline.setState({ jobs: next, ids: { ...ids, [id]: true }, version: version + 1 });
      setTimeout(() => queue.clear(id), 4000); // the "done" badge disappears by itself
    } else if (state?.status === 'error') {
      pending.delete(id);
      useOffline.setState({ jobs: next });
      setTimeout(() => queue.clear(id), 60000); // long enough to read the reason (and to share it with a long press)
    } else {
      if (!state) pending.delete(id);
      useOffline.setState({ jobs: next });
    }
  },
);
