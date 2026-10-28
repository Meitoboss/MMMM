import TrackPlayer from 'react-native-track-player';
import { create } from 'zustand';

import { getConfig } from '../core/config';
import { MAX_RATE, MIN_RATE, scaleLoopRegion } from '../core/beat';
import { FADE_STEP_MS, type Trim, fadeBetween, fadeGain, onThisPhone, planFadeOut } from '../core/dj';
import { type LoopRegion, loopJumpTarget, makeLoop } from '../core/loop';
import { isDoubledDuration, songEnd } from '../core/songLength';
import { normalizedVolume } from '../core/loudness';
import { isLocalId } from '../core/localMeta';
import { yt } from '../core';
import { isPremiumOnly, resolveAudio } from '../core/streams/resolver';
import { hiResCover } from '../core/taste';
import type { AudioSource, SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { resolveFocus, isFocusId } from '../player/focus';
import { focusLoopPosition, loadFocusLoop, pauseFocusLoop, playFocusLoop, setFocusLoopVolume, stopFocusLoop } from '../player/focusLoop';
import { resolveLocal } from '../player/localFiles';
import { resolveOffline } from '../player/offline';
import { cacheAudio, cachedAudio } from '../player/autoCache';
import { ambientFactor } from '../player/binaural';
import { LOOP_INTERVAL, NORMAL_INTERVAL, ensurePlayer, setProgressInterval } from '../player/setup';
import { useOffline } from './offline';
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
  /** loop exactly this region (a lyric line, a beat loop); by default it also jumps to the start – `seek: false` lets the song play on */
  loopRegion: (region: LoopRegion, opts?: { seek?: boolean }) => Promise<void>;
  /** the loop twice as long (2) or half as long (0.5), from the same start */
  scaleLoop: (factor: number) => void;
  /** a playback speed for THIS song only (tempo matching); null = the usual speed again. A new song always starts at the usual speed. */
  tempo: number | null;
  /** the full player screen is open (the mini bar is hidden then) */
  playerScreenOpen: boolean;
  setPlayerScreenOpen: (open: boolean) => void;
  setTempo: (rate: number | null) => Promise<void>;
  /** the exact position now, in seconds (the position on screen is only refreshed twice a second) */
  getPosition: () => Promise<number>;
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

/** how many lines of the playback log are kept (the log is shown in Settings → 再生ログを表示) */
const DEBUG_LINES = 40;
let doubledLogged = -1; // the load for which "the file says double" was written to the log
let doubledLockFixed = -1; // the load for which the lock screen was given the song's own length
let lastSource = ''; // what the song that is playing was resolved to: via, itag, mime type – written next to "the file says double"
let loadToken = 0;
let loadedAt = 0;
/** how long a song must play before it is kept on the phone */
const AUTO_CACHE_AFTER_MS = 45_000;
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
/** the share the binaural tone leaves the environment sound (1 for songs, and when the tone is off) */
let ambientMul = 1;
const effectiveVolume = (): number => baseVolume * ambientMul;
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
  if (restore && wasFading) TrackPlayer.setVolume(effectiveVolume()).catch(() => undefined);
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
      TrackPlayer.setVolume(kind === 'out' ? 0 : effectiveVolume()).catch(() => undefined);
      done?.();
      return;
    }
    TrackPlayer.setVolume(effectiveVolume() * fadeGain(kind, t)).catch(() => undefined);
  }, FADE_STEP_MS);
  fadeTimer = timer;
}

const fadeMs = (): number => Math.max(0, useSettings.getState().fadeSeconds) * 1000;
/** fades are for songs on this phone only (see fadeBetween) */
const fadeMsBetween = (from: SongItem | undefined, to: SongItem | undefined): number => (fadeBetween(from?.id, to?.id, useOffline.getState().ids) ? fadeMs() : 0);

let sleepTimeout: ReturnType<typeof setTimeout> | undefined;

async function flushPlayTime(song?: SongItem) {
  const ms = playedMs;
  playedMs = 0;
  // the 集中 sounds are a separate part of the app: they do not count as listening (not in 最近, not in the statistics)
  if (!song || ms < 1000 || isFocusId(song.id)) return;
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
    ambientMul = isFocusId(song.id) ? ambientFactor() : 1;
    await TrackPlayer.setVolume(volume * ambientMul);
    log(`volume=${volume.toFixed(2)} (${mode}, loudness ${loudness === undefined ? 'unknown' : `${loudness.toFixed(1)} dB`})`);
    return volume;
  } catch {
    ambientMul = 1;
    await TrackPlayer.setVolume(1).catch(() => undefined);
    return 1;
  }
}

/** the environment sound follows the binaural tone: call after the tone or its settings change */
export function refreshAmbient(): void {
  const current = usePlayer.getState().current;
  if (!current || !isFocusId(current.id)) return;
  ambientMul = ambientFactor();
  setFocusLoopVolume(effectiveVolume());
  TrackPlayer.setVolume(effectiveVolume()).catch(() => undefined);
}

export const usePlayer = create<PlayerState>((set, get) => {
  /** a 集中 sound: played by the two-player loop (its own engine), after the music player is cleared */
  async function loadFocus(song: SongItem, token: number) {
    try {
      await ensurePlayer();
      await TrackPlayer.reset();
      const src = await resolveFocus(song.id);
      if (token !== loadToken) return; // user skipped again while resolving
      ambientMul = ambientFactor();
      await loadFocusLoop(src.url, effectiveVolume(), { title: song.title, artist: '集中' }); // the lock screen shows the sound
      if (token !== loadToken) return;
      playFocusLoop();
      loadedAt = Date.now();
      get().log(`focus loop ${song.id}`);
      set({ status: 'playing' });
    } catch (e) {
      if (token === loadToken) {
        const msg = e instanceof Error ? e.message : String(e);
        get().log(`FAILED ${msg.split('\n')[0]}`);
        set({ status: 'error', error: msg });
      }
    }
  }

  /** a song that has played for a while is kept on the phone, so it starts at once the next time */
  function scheduleAutoCache(songId: string): void {
    setTimeout(() => {
      const cur = get().current;
      if (!cur || cur.id !== songId || get().status !== 'playing' || isLocalId(songId) || isFocusId(songId)) return;
      void (async () => {
        if ((await cachedAudio(songId)) || (await resolveOffline(songId))) return;
        await cacheAudio(songId, await resolveAudio(songId, resolverOptions()));
      })().catch(() => undefined);
    }, AUTO_CACHE_AFTER_MS);
  }

  /** `fadeIn`: start silent and fade up (the song was reached by itself – the end of the previous one) */
  async function loadAt(index: number, startAt = 0, fadeIn = false) {
    const song = get().queue[index];
    if (!song) return;
    const token = ++loadToken;
    await flushPlayTime(get().current);
    stopFadeTimers();
    trimEndSec = null;
    set({ index, current: song, status: 'loading', error: undefined, needsLoad: false, resumePosition: undefined, loop: null, loopA: undefined, trim: null, tempo: null });
    wantFineProgress(false);
    get().log(`load ${song.id} (#${index + 1}/${get().queue.length})`);
    if (isFocusId(song.id)) return loadFocus(song, token);
    stopFocusLoop(); // a normal song: the 集中 loop (if it was playing) stops
    try {
      await ensurePlayer();
      const src = isFocusId(song.id)
        ? await resolveFocus(song.id)
        : isLocalId(song.id)
          ? await resolveLocal(song.id)
          : (await resolveOffline(song.id)) ?? (await cachedAudio(song.id)) ?? (await resolveAudio(song.id, resolverOptions())); // a saved or kept copy plays without the network
      if (token !== loadToken) return; // user skipped again while resolving
      // start / end trim of this song (best effort)
      const trim = onThisPhone(song.id, useOffline.getState().ids) ? await openDb().then((db) => repo.trimOf(db, song.id)).catch(() => null) : null;
      if (token !== loadToken) return;
      trimEndSec = trim?.endSec ?? null;
      set({ trim });
      wantFineProgress(trimEndSec !== null);
      if (startAt === 0 && trim?.startSec) startAt = trim.startSec;
      lastSource = `via=${src.via} itag=${src.itag ?? '-'} ${src.mimeType ?? ''}`.trim();
      get().log(`resolved via=${src.via} itag=${src.itag ?? '-'} ${src.mimeType ?? ''} host=${String(src.url).split('/')[2]}${src.note ? ` ${src.note}` : ''}`);
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: song.id,
        url: src.url,
        title: song.title,
        artist: song.artists.map((a) => a.name).join(', '),
        album: song.album?.name,
        artwork: hiResCover(song.thumbnail, 1080), // the lock screen and the notification: the same big cover as the player screen
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
      // warm the addresses of the next songs, so skipping is instant
      for (const upcoming of get().queue.slice(index + 1, index + 4)) {
        if (!isLocalId(upcoming.id) && !isFocusId(upcoming.id)) resolveAudio(upcoming.id, resolverOptions()).catch(() => undefined);
      }
      scheduleAutoCache(song.id);
    } catch (e) {
      if (token === loadToken) {
        const msg = e instanceof Error ? e.message : String(e);
        get().log(`FAILED ${msg.split('\n')[0]}`);
        // a song only YouTube Music Premium members can hear: skip it, and go on with the next one
        const { queue, index, repeat } = get();
        if (isPremiumOnly(msg) && (index + 1 < queue.length || (repeat === 'all' && queue.length))) {
          get().log('会員限定の曲なので、次の曲へ進みます');
          void advance(false);
          return;
        }
        set({ status: 'error', error: msg });
      }
    }
  }

  /** to the next song. `auto`: the previous one ended by itself – then the next one fades in (when a fade is set) */
  async function advance(auto: boolean): Promise<void> {
    const { queue, index, repeat, current } = get();
    const upcoming = index + 1 < queue.length ? queue[index + 1] : repeat === 'all' ? queue[0] : undefined;
    const fadeIn = auto && fadeMsBetween(current, upcoming) > 0;
    if (index + 1 < queue.length) return loadAt(index + 1, 0, fadeIn);
    if (repeat === 'all' && queue.length) return loadAt(0, 0, fadeIn);
    if (useSettings.getState().autoRadio && current && (await appendRadio(current)) > 0) return loadAt(index + 1, 0, fadeIn);
    await flushPlayTime(current);
    cancelFade(true);
    pauseFocusLoop();
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
    tempo: null,
    playerScreenOpen: false,
    setPlayerScreenOpen: (open) => set({ playerScreenOpen: open }),
    debug: [],
    log: (line) => {
      const t = new Date();
      const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      set({ debug: [...get().debug.slice(-(DEBUG_LINES - 1)), `${hh} ${line}`] });
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
      const focusNow = get().current;
      if (focusNow && isFocusId(focusNow.id)) {
        // a 集中 sound: its own loop plays and pauses (the music player is not used for it)
        const st = get().status;
        if (st === 'playing') {
          pauseFocusLoop();
          set({ status: 'paused' });
        } else if (st === 'paused') {
          playFocusLoop();
          set({ status: 'playing' });
        } else if (st === 'error') {
          await loadAt(get().index);
        }
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
      else if (get().current && isFocusId(get().current!.id)) return; // a 集中 sound is not seeked
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

    loopRegion: async (region, opts) => {
      set({ loop: region, loopA: undefined });
      cancelFade(true);
      wantFineProgress(true);
      lastLoopJumpAt = Date.now();
      if (opts?.seek !== false) await get().seekTo(region.start);
    },

    scaleLoop: (factor) => {
      const { loop, current } = get();
      if (!loop) return;
      const next = scaleLoopRegion(loop, factor, current?.durationSec);
      if (next) set({ loop: next });
    },

    setTempo: async (rate) => {
      const r = rate === null ? null : Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
      set({ tempo: r });
      await ensurePlayer();
      await TrackPlayer.setRate(r ?? get().rate); // the saved speed setting is not touched
    },

    getPosition: async () => {
      const { needsLoad, resumePosition } = get();
      if (needsLoad) return resumePosition ?? 0;
      if (get().current && isFocusId(get().current!.id)) return focusLoopPosition();
      try {
        return (await TrackPlayer.getProgress()).position;
      } catch {
        return 0;
      }
    },

    markTrimStart: async (position) => {
      const song = get().current;
      if (!song || !onThisPhone(song.id, useOffline.getState().ids)) return null;
      const kept = await repo.setTrim(await openDb(), song, { startSec: position, endSec: get().trim?.endSec });
      set({ trim: kept });
      trimEndSec = kept?.endSec ?? null;
      wantFineProgress(!!get().loop || trimEndSec !== null);
      return kept;
    },

    markTrimEnd: async (position) => {
      const song = get().current;
      if (!song || !onThisPhone(song.id, useOffline.getState().ids)) return null;
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
      // a file that claims about twice the song's length (the second half is silence): the song ends at its own length
      const known = get().current?.durationSec;
      const doubled = isDoubledDuration(duration, known);
      if (doubled && doubledLogged !== loadToken) {
        doubledLogged = loadToken;
        get().log(`length: the file says ${Math.round(duration)}s, the song is ${Math.round(known ?? 0)}s – it ends at ${Math.round(known ?? 0)}s${lastSource ? ` [${lastSource}]` : ''}`);
      }
      // the lock screen and the notification take the file's length too: they show the song's own length instead
      if (doubled && doubledLockFixed !== loadToken) {
        doubledLockFixed = loadToken;
        void TrackPlayer.updateNowPlayingMetadata({ duration: known ?? undefined }).catch(() => undefined);
      }
      const queue = get().queue;
      const upcoming = get().index + 1 < queue.length ? queue[get().index + 1] : get().repeat === 'all' ? queue[0] : undefined;
      const fadeSec = fadeMsBetween(get().current, upcoming) / 1000;
      const end = trimEndSec ?? songEnd(duration, known);
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

      // 3. the end of a song whose file claims double: go to the next song instead of playing the silence
      if (doubled && trimEndSec === null && known && leftSongToken !== loadToken && position >= known - 0.2) {
        leftSongToken = loadToken;
        if (get().repeat === 'one') {
          // "repeat one": the same song again from the start (as when a song really ends); the end of the next round is handled the same way
          stopFadeTimers();
          void (async () => {
            await TrackPlayer.setVolume(effectiveVolume()).catch(() => undefined);
            await TrackPlayer.seekTo(0).catch(() => undefined);
            await TrackPlayer.play().catch(() => undefined);
            leftSongToken = -1;
          })();
        } else {
          void advance(true);
        }
        return;
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
      set({ rate, tempo: null });
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
        pauseFocusLoop();
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
        await TrackPlayer.setVolume(effectiveVolume()).catch(() => undefined);
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
