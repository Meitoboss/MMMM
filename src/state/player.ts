import TrackPlayer from 'react-native-track-player';
import { create } from 'zustand';

import { getConfig } from '../core/config';
import { FADE_STEP_MS, type Trim, fadeGain, planFadeOut } from '../core/dj';
import { type LoopRegion, loopJumpTarget, makeLoop } from '../core/loop';
import { normalizedVolume } from '../core/loudness';
import { isLocalId } from '../core/localMeta';
import { yt } from '../core';
import { resolveAudio } from '../core/streams/resolver';
import type { AudioSource, SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { resolveLocal } from '../player/localFiles';
import { resolveOffline } from '../player/offline';
import { LOOP_INTERVAL, NORMAL_INTERVAL, ensurePlayer, setProgressInterval } from '../player/setup';
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
  /** restored from the last session: nothing is loaded in the player yet – pressing play loads it and jumps to `resumePosition` */
  needsLoad: boolean;
  /** seconds into the current song, while `needsLoad` */
  resumePosition?: number;
  /** section loop (A-B repeat): the playing song jumps back from `end` to `start` */
  loop: LoopRegion | null;
  /** A has been marked, B is still to come */
  loopA?: number;
  /** last playback events, shown on the player screen to explain silent failures */
  debug: string[];
  log: (line: string) => void;

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
  /** start / end trim of the current song (null = none) */
  trim: Trim | null;
  /** saves the trim (it is checked first); returns what was kept, or null when nothing valid is left */
  markTrimStart: (position: number) => Promise<Trim | null>;
  markTrimEnd: (position: number) => Promise<Trim | null>;
  clearTrim: () => Promise<void>;
  /** called with every progress event: fade out near the end, leave a song at its trimmed end */
  checkTransition: (position: number, duration: number) => void;
  markLoopA: (position: number) => void;
  markLoopB: (position: number) => void;
  /** loop exactly this region (used for one lyric line) and jump to its start */
  loopRegion: (region: LoopRegion) => Promise<void>;
  clearLoop: () => void;
  /** called with every progress event of the player */
  checkLoop: (position: number) => void;
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
let loadedAt = 0;
let playedMs = 0;
let lastTickAt = Date.now();
let lastLoopJumpAt = 0;
let fineProgress = false;

/** progress events every 0.25 s while a loop runs, every 1 s otherwise */
function wantFineProgress(fine: boolean): void {
  if (fine === fineProgress) return;
  fineProgress = fine;
  setProgressInterval(fine ? LOOP_INTERVAL : NORMAL_INTERVAL).catch(() => undefined);
}

/* ---- DJ-style: fade between songs, start / end trim ---- */
let baseVolume = 1; // the normalised volume of the song that is playing – fades go from / to this
let trimEndSec: number | null = null;
let fadeTimer: ReturnType<typeof setInterval> | undefined;
let fadeStartTimer: ReturnType<typeof setTimeout> | undefined;
let fadePlanned = false;
/** the song (load) that has already been left automatically – so one song is never left twice, however short it is */
let leftSongToken = -1;

function stopFadeTimers(): void {
  if (fadeTimer) clearInterval(fadeTimer);
  if (fadeStartTimer) clearTimeout(fadeStartTimer);
  fadeTimer = undefined;
  fadeStartTimer = undefined;
  fadePlanned = false;
}

/** stops a fade; with `restore` the song goes back to its normal volume (paused / sought back / loop started) */
function cancelFade(restore: boolean): void {
  const wasFading = fadePlanned || fadeTimer !== undefined;
  stopFadeTimers();
  if (restore && wasFading) TrackPlayer.setVolume(baseVolume).catch(() => undefined);
}

/** steps the volume along an equal-power curve, driven by the clock (not by progress events, which are too coarse) */
function ramp(kind: 'in' | 'out', durationMs: number, done?: () => void): void {
  if (fadeTimer) clearInterval(fadeTimer);
  const t0 = Date.now();
  const timer = setInterval(() => {
    const t = (Date.now() - t0) / Math.max(1, durationMs);
    if (t >= 1) {
      clearInterval(timer);
      if (fadeTimer === timer) fadeTimer = undefined;
      TrackPlayer.setVolume(kind === 'out' ? 0 : baseVolume).catch(() => undefined);
      done?.();
      return;
    }
    TrackPlayer.setVolume(baseVolume * fadeGain(kind, t)).catch(() => undefined);
  }, FADE_STEP_MS);
  fadeTimer = timer;
}

const fadeMs = (): number => Math.max(0, useSettings.getState().fadeSeconds) * 1000;

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

/**
 * Evens out the volume between songs (Settings → Playback). Uses the loudness YouTube reports for the video;
 * for a saved copy it is read from the database. Never allowed to get in the way of playing.
 */
async function applyVolume(song: SongItem, src: AudioSource, log: (line: string) => void): Promise<number> {
  try {
    const mode = useSettings.getState().volumeNormalize;
    let loudness = src.loudnessDb;
    if (!isLocalId(song.id)) {
      const db = await openDb();
      if (loudness === undefined) loudness = (await repo.loudnessFor(db, song.id)) ?? undefined;
      else if (src.via !== 'offline') {
        repo.saveFormat(db, song, { itag: src.itag, mimeType: src.mimeType, bitrate: src.bitrate, contentLength: src.contentLength, loudnessDb: loudness }).catch(() => undefined);
      }
    }
    const volume = normalizedVolume(loudness, mode);
    await TrackPlayer.setVolume(volume);
    log(`volume=${volume.toFixed(2)} (${mode}, loudness ${loudness === undefined ? 'unknown' : `${loudness.toFixed(1)} dB`})`);
    return volume;
  } catch {
    await TrackPlayer.setVolume(1).catch(() => undefined);
    return 1;
  }
}

export const usePlayer = create<PlayerState>((set, get) => {
  /** `fadeIn`: start silent and fade up (the song was reached by itself – the end of the previous one) */
  async function loadAt(index: number, startAt = 0, fadeIn = false) {
    const song = get().queue[index];
    if (!song) return;
    const token = ++loadToken;
    await flushPlayTime(get().current);
    stopFadeTimers();
    trimEndSec = null;
    set({ index, current: song, status: 'loading', error: undefined, needsLoad: false, resumePosition: undefined, loop: null, loopA: undefined, trim: null });
    wantFineProgress(false);
    get().log(`load ${song.id} (#${index + 1}/${get().queue.length})`);
    try {
      await ensurePlayer();
      const src = isLocalId(song.id)
        ? await resolveLocal(song.id)
        : (await resolveOffline(song.id)) ?? (await resolveAudio(song.id, resolverOptions())); // a saved copy plays without the network
      if (token !== loadToken) return; // user skipped again while resolving
      // start / end trim of this song (best effort)
      const trim = await openDb().then((db) => repo.trimOf(db, song.id)).catch(() => null);
      if (token !== loadToken) return;
      trimEndSec = trim?.endSec ?? null;
      set({ trim });
      wantFineProgress(trimEndSec !== null);
      if (startAt === 0 && trim?.startSec) startAt = trim.startSec;
      get().log(`resolved via=${src.via} itag=${src.itag ?? '-'} ${src.mimeType ?? ''} host=${String(src.url).split('/')[2]}${src.note ? ` ${src.note}` : ''}`);
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: song.id,
        url: src.url,
        title: song.title,
        artist: song.artists.map((a) => a.name).join(', '),
        album: song.album?.name,
        artwork: song.thumbnail,
        duration: song.durationSec,
        // A custom user agent makes AVPlayer fail on PO-token streams (diagnostics 8.1 vs 8.2) – only the old iOS-client URLs need one.
        userAgent: src.via === 'innertube' ? getConfig().ios.userAgent : undefined,
        contentType: src.mimeType,
      });
      await TrackPlayer.setRate(get().rate);
      baseVolume = await applyVolume(song, src, get().log);
      if (fadeIn) await TrackPlayer.setVolume(0);
      if (startAt > 0) await TrackPlayer.seekTo(startAt); // a restored session, or the trimmed start
      await TrackPlayer.play();
      if (fadeIn) ramp('in', fadeMs());
      loadedAt = Date.now();
      get().log('play() called');
      // for the home screen's "recently played" shelf (best effort, never blocks playback)
      openDb().then((db) => repo.markPlayed(db, song)).catch(() => undefined);
      set({ status: 'playing' });
      // warm the URL cache for the next song so skipping is instant
      const upcoming = get().queue[index + 1];
      if (upcoming && !isLocalId(upcoming.id)) resolveAudio(upcoming.id, resolverOptions()).catch(() => undefined);
    } catch (e) {
      if (token === loadToken) {
        const msg = e instanceof Error ? e.message : String(e);
        get().log(`FAILED ${msg.split('\n')[0]}`);
        set({ status: 'error', error: msg });
      }
    }
  }

  /** to the next song. `auto`: the previous one ended by itself – then the next one fades in (when a fade is set) */
  async function advance(auto: boolean): Promise<void> {
    const { queue, index, repeat, current } = get();
    const fadeIn = auto && fadeMs() > 0;
    if (index + 1 < queue.length) return loadAt(index + 1, 0, fadeIn);
    if (repeat === 'all' && queue.length) return loadAt(0, 0, fadeIn);
    if (useSettings.getState().autoRadio && current && (await appendRadio(current)) > 0) return loadAt(index + 1, 0, fadeIn);
    await flushPlayTime(current);
    cancelFade(true);
    await TrackPlayer.pause();
    set({ status: 'paused' });
  }

  async function appendRadio(from: SongItem): Promise<number> {
    if (isLocalId(from.id)) return 0; // no YouTube radio for a file on the device
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
    needsLoad: false,
    loop: null,
    trim: null,
    debug: [],
    log: (line) => {
      const t = new Date();
      const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      set({ debug: [...get().debug.slice(-9), `${hh} ${line}`] });
    },
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

    next: () => advance(false),

    previous: async () => {
      const { index } = get();
      if (get().needsLoad) {
        // nothing loaded yet: "back" restarts the restored song, or goes to the one before it
        if ((get().resumePosition ?? 0) > 3 || index === 0) set({ resumePosition: 0 });
        else await loadAt(index - 1);
        return;
      }
      const { position } = await TrackPlayer.getProgress();
      if (position > 3 || index === 0) {
        await TrackPlayer.seekTo(0);
        return;
      }
      await loadAt(index - 1);
    },

    togglePlay: async () => {
      if (get().needsLoad) {
        await loadAt(get().index, get().resumePosition ?? 0);
        return;
      }
      const { status } = get();
      if (status === 'playing') {
        cancelFade(true);
        await TrackPlayer.pause();
        set({ status: 'paused' });
      } else if (status === 'paused') {
        await TrackPlayer.play();
        set({ status: 'playing' });
      } else if (status === 'error') {
        await loadAt(get().index);
      }
    },

    seekTo: async (s) => {
      if (get().needsLoad) set({ resumePosition: s });
      else {
        cancelFade(true);
        await TrackPlayer.seekTo(s);
      }
    },

    markLoopA: (position) => set({ loopA: position, loop: null }),

    markLoopB: (position) => {
      const a = get().loopA;
      if (a === undefined) return;
      const loop = makeLoop(a, position, get().current?.durationSec);
      set({ loop, loopA: undefined });
      if (loop) cancelFade(true);
      wantFineProgress(!!loop || trimEndSec !== null);
    },

    loopRegion: async (region) => {
      set({ loop: region, loopA: undefined });
      cancelFade(true);
      wantFineProgress(true);
      lastLoopJumpAt = Date.now();
      await get().seekTo(region.start);
    },

    markTrimStart: async (position) => {
      const song = get().current;
      if (!song) return null;
      const kept = await repo.setTrim(await openDb(), song, { startSec: position, endSec: get().trim?.endSec });
      set({ trim: kept });
      trimEndSec = kept?.endSec ?? null;
      wantFineProgress(!!get().loop || trimEndSec !== null);
      return kept;
    },

    markTrimEnd: async (position) => {
      const song = get().current;
      if (!song) return null;
      const kept = await repo.setTrim(await openDb(), song, { startSec: get().trim?.startSec, endSec: position });
      set({ trim: kept });
      trimEndSec = kept?.endSec ?? null;
      wantFineProgress(!!get().loop || trimEndSec !== null);
      return kept;
    },

    clearTrim: async () => {
      const song = get().current;
      if (!song) return;
      await repo.setTrim(await openDb(), song, null);
      set({ trim: null });
      trimEndSec = null;
      wantFineProgress(!!get().loop);
    },

    checkTransition: (position, duration) => {
      const { loop, status, needsLoad } = get();
      if (loop) return cancelFade(true);
      if (status !== 'playing' || needsLoad) return;
      const fadeSec = fadeMs() / 1000;
      const end = trimEndSec ?? (duration > 0 ? duration : null);
      if (end === null) return;

      // 1. fade out before the end (the end of the song, or its trimmed end)
      if (fadeSec > 0) {
        if (fadePlanned && end - position > fadeSec + 2) cancelFade(true); // sought back: start over from there
        if (!fadePlanned) {
          const plan = planFadeOut(position, end, fadeSec);
          if (plan) {
            fadePlanned = true;
            const leaveAtTrim = trimEndSec !== null;
            fadeStartTimer = setTimeout(
              () =>
                ramp('out', plan.durationMs, () => {
                  if (!leaveAtTrim || leftSongToken === loadToken) return;
                  leftSongToken = loadToken;
                  void advance(true);
                }),
              plan.startInMs,
            );
          }
        }
      }

      // 2. a trimmed end: go to the next song (a running fade does it itself, unless it fell behind)
      if (trimEndSec !== null && leftSongToken !== loadToken) {
        const fadeDoesIt = fadePlanned && position < trimEndSec + 1;
        if (!fadeDoesIt && position >= trimEndSec - 0.1) {
          leftSongToken = loadToken;
          void advance(true);
        }
      }
    },

    clearLoop: () => {
      set({ loop: null, loopA: undefined });
      wantFineProgress(trimEndSec !== null);
    },

    checkLoop: (position) => {
      const { loop, status, needsLoad } = get();
      if (!loop || status !== 'playing' || needsLoad) return;
      const target = loopJumpTarget(position, loop, Date.now(), lastLoopJumpAt);
      if (target === null) return;
      lastLoopJumpAt = Date.now();
      void TrackPlayer.seekTo(target);
    },

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
      // A "queue ended" that arrives right after loading is spurious (e.g. caused by reset()) – ignore it.
      const progress = await TrackPlayer.getProgress().catch(() => ({ position: 0, duration: 0 }));
      if (Date.now() - loadedAt < 4000 || (progress.duration > 0 && progress.position < 3)) {
        get().log(`ignored queueEnded (pos ${progress.position.toFixed(1)}/${progress.duration.toFixed(0)})`);
        return;
      }
      if (repeat === 'one') {
        stopFadeTimers();
        await TrackPlayer.setVolume(baseVolume).catch(() => undefined);
        await TrackPlayer.seekTo(0);
        await TrackPlayer.play();
        return;
      }
      await advance(true);
    },

    setStatus: (status) => set({ status }),
    // Counts real elapsed time, so the progress interval can change (0.25 s for the loop) without changing the statistics.
    // A long gap means playback was paused in between: not counted.
    tick: () => {
      const t = Date.now();
      const gap = t - lastTickAt;
      lastTickAt = t;
      if (get().status === 'playing' && gap > 0 && gap <= 1500) playedMs += gap;
    },
  };
});
