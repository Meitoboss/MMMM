import Storage from 'expo-sqlite/kv-store';
import TrackPlayer from 'react-native-track-player';

import { parseResume, serializeResume, startPosition } from '../core/resume';
import { usePlayer } from './player';
import { useSettings } from './settings';

/**
 * "Continue where you left off". The queue is saved whenever it (or the current song, or repeat / shuffle) changes; the
 * position every few seconds while playing and when playback pauses. At the next start the player comes back PAUSED
 * (nothing starts by itself) and pressing play continues from the saved position.
 */
const KEY = 'player.resume.v1';
const POSITION_EVERY_MS = 5000;

let lastPosition = 0;
let lastSavedAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function save(): void {
  if (!useSettings.getState().resumeOnLaunch) return;
  const { queue, index, repeat, shuffle } = usePlayer.getState();
  if (!queue.length) return;
  try {
    Storage.setItemSync(KEY, serializeResume({ queue, index, position: lastPosition, repeat, shuffle }));
    lastSavedAt = Date.now();
  } catch {
    /* nothing to be done: the next change tries again */
  }
}

function saveSoon(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(save, 400);
}

/** called by the playback service with every progress event */
export function noteProgress(position: number): void {
  lastPosition = position;
  if (Date.now() - lastSavedAt >= POSITION_EVERY_MS) save();
}

/** Brings the last session back, paused. Does nothing when something is already loaded or nothing was saved. */
export function restoreResume(): void {
  if (!useSettings.getState().resumeOnLaunch) return;
  const p = usePlayer.getState();
  if (p.queue.length || p.status !== 'idle') return;
  let raw: string | null = null;
  try {
    raw = Storage.getItemSync(KEY);
  } catch {
    return;
  }
  const saved = parseResume(raw);
  if (!saved) return;
  const song = saved.queue[saved.index];
  lastPosition = startPosition(saved.position, song.durationSec);
  usePlayer.setState({
    queue: saved.queue,
    index: saved.index,
    current: song,
    status: 'paused',
    repeat: saved.repeat,
    shuffle: saved.shuffle,
    needsLoad: true,
    resumePosition: lastPosition,
  });
}

let started = false;
export function startResumeSaving(): void {
  if (started) return;
  started = true;
  usePlayer.subscribe((s, prev) => {
    if (s.current?.id !== prev.current?.id && !s.needsLoad) lastPosition = 0; // a new song starts at the beginning
    if (s.queue !== prev.queue || s.index !== prev.index || s.repeat !== prev.repeat || s.shuffle !== prev.shuffle) saveSoon();
    if (prev.status === 'playing' && s.status === 'paused' && !s.needsLoad) {
      TrackPlayer.getProgress()
        .then((p) => {
          lastPosition = p.position;
          save();
        })
        .catch(() => undefined);
    }
  });
}
