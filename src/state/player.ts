import TrackPlayer from 'react-native-track-player';
import { create } from 'zustand';

import { getConfig } from '../core/config';
import { yt } from '../core';
import { resolveAudio } from '../core/streams/resolver';
import type { SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { ensurePlayer } from '../player/setup';
import { resolverOptions, useSettings } from './settings';

export type RepeatMode = 'off' | 'all' | 'one';
export type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface PlayerState {
  queue: SongItem[];
  index: number;
  current?: SongItem;
  status: Status;
  error?: string;
  repeat: RepeatMode;
  shuffle: boolean;
  rate: number;
  /** epoch ms when the sleep timer fires */
  sleepAt?: number;

  playSongs: (songs: SongItem[], startIndex?: number) => Promise<void>;
  playRadio: (song: SongItem) => Promise<void>;
  playNext: (song: SongItem) => void;
  enqueue: (song: SongItem) => void;
  removeFromQueue: (index: number) => void;
  jumpTo: (index: number) => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  togglePlay: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  setRepeat: (m: RepeatMode) => void;
  toggleShuffle: () => void;
  setRate: (r: number) => Promise<void>;
  setSleepTimer: (minutes: number | null) => void;
  /** called by the playback service */
  onEnded: () => Promise<void>;
  setStatus: (s: Status) => void;
  tick: () => void;
}

let loadToken = 0;
let playedMs = 0;
let sleepTimeout: ReturnType<typeof setTimeout> | undefined;

async function flushPlayTime(song?: SongItem) {
  const ms = playedMs;
  playedMs = 0;
  if (!song || ms < 1000) return;
  try {
    await repo.recordPlay(await openDb(), song, ms);
  } catch {
    /* statistics are best effort */
  }
}

function shuffleTail<T>(arr: T[], from: number): T[] {
  const head = arr.slice(0, from);
  const tail = arr.slice(from);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  return [...head, ...tail];
}

export const usePlayer = create<PlayerState>((set, get) => {
  async function loadAt(index: number) {
    const song = get().queue[index];
    if (!song) return;
    const token = ++loadToken;
    await flushPlayTime(get().current);
    set({ index, current: song, status: 'loading', error: undefined });
    try {
      await ensurePlayer();
      const src = await resolveAudio(song.id, resolverOptions());
      if (token !== loadToken) return; // user skipped again while resolving
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: song.id,
        url: src.url,
        title: song.title,
        artist: song.artists.map((a) => a.name).join(', '),
        album: song.album?.name,
        artwork: song.thumbnail,
        duration: song.durationSec,
        userAgent: src.via === 'innertube' ? getConfig().ios.userAgent : undefined,
      });
      await TrackPlayer.setRate(get().rate);
      await TrackPlayer.play();
      set({ status: 'playing' });
      // warm the URL cache for the next song so skipping is instant
      const upcoming = get().queue[index + 1];
      if (upcoming) resolveAudio(upcoming.id, resolverOptions()).catch(() => undefined);
    } catch (e) {
      if (token === loadToken) set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function appendRadio(from: SongItem): Promise<number> {
    try {
      const page = await yt.radio(from.id);
      const known = new Set(get().queue.map((s) => s.id));
      const fresh = page.songs.filter((s) => !known.has(s.id));
      if (fresh.length) set({ queue: [...get().queue, ...fresh] });
      return fresh.length;
    } catch {
      return 0;
    }
  }

  return {
    queue: [],
    index: 0,
    status: 'idle',
    repeat: 'off',
    shuffle: false,
    rate: useSettings.getState().playbackRate,

    playSongs: async (songs, startIndex = 0) => {
      let queue = songs;
      let idx = startIndex;
      if (get().shuffle) {
        const first = songs[startIndex];
        queue = [first, ...shuffleTail(songs.filter((_, i) => i !== startIndex), 0)];
        idx = 0;
      }
      set({ queue });
      await loadAt(idx);
    },

    playRadio: async (song) => {
      set({ queue: [song] });
      await loadAt(0);
      await appendRadio(song);
    },

    playNext: (song) => {
      const { queue, index } = get();
      const q = [...queue];
      q.splice(index + 1, 0, song);
      set({ queue: q });
    },

    enqueue: (song) => set({ queue: [...get().queue, song] }),

    removeFromQueue: (i) => {
      const { queue, index } = get();
      if (i === index) return;
      set({ queue: queue.filter((_, k) => k !== i), index: i < index ? index - 1 : index });
    },

    jumpTo: (i) => loadAt(i),

    next: async () => {
      const { queue, index, repeat, current } = get();
      if (index + 1 < queue.length) return loadAt(index + 1);
      if (repeat === 'all' && queue.length) return loadAt(0);
      if (useSettings.getState().autoRadio && current && (await appendRadio(current)) > 0) {
        return loadAt(index + 1);
      }
      await flushPlayTime(current);
      await TrackPlayer.pause();
      set({ status: 'paused' });
    },

    previous: async () => {
      const { index } = get();
      const { position } = await TrackPlayer.getProgress();
      if (position > 3 || index === 0) {
        await TrackPlayer.seekTo(0);
        return;
      }
      await loadAt(index - 1);
    },

    togglePlay: async () => {
      const { status } = get();
      if (status === 'playing') {
        await TrackPlayer.pause();
        set({ status: 'paused' });
      } else if (status === 'paused') {
        await TrackPlayer.play();
        set({ status: 'playing' });
      } else if (status === 'error') {
        await loadAt(get().index);
      }
    },

    seekTo: (s) => TrackPlayer.seekTo(s),

    setRepeat: (repeat) => set({ repeat }),

    toggleShuffle: () => {
      const { shuffle, queue, index } = get();
      set({ shuffle: !shuffle, queue: !shuffle ? shuffleTail(queue, index + 1) : queue });
    },

    setRate: async (rate) => {
      set({ rate });
      useSettings.getState().update({ playbackRate: rate });
      await ensurePlayer();
      await TrackPlayer.setRate(rate);
    },

    setSleepTimer: (minutes) => {
      if (sleepTimeout) clearTimeout(sleepTimeout);
      sleepTimeout = undefined;
      if (!minutes) return set({ sleepAt: undefined });
      set({ sleepAt: Date.now() + minutes * 60_000 });
      sleepTimeout = setTimeout(async () => {
        await TrackPlayer.pause();
        set({ status: 'paused', sleepAt: undefined });
      }, minutes * 60_000);
    },

    onEnded: async () => {
      const { repeat } = get();
      if (repeat === 'one') {
        await TrackPlayer.seekTo(0);
        await TrackPlayer.play();
        return;
      }
      await get().next();
    },

    setStatus: (status) => set({ status }),
    tick: () => {
      if (get().status === 'playing') playedMs += 1000;
    },
  };
});
