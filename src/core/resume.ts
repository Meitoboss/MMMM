import type { SongItem } from './types';

/**
 * "Continue where you left off": what is saved of the player, and how it is read back.
 * Whatever is in storage is checked before it is used – a damaged save must never break the app.
 */
export type RepeatMode = 'off' | 'all' | 'one';

export interface ResumeState {
  queue: SongItem[];
  index: number;
  /** seconds into the current song */
  position: number;
  repeat: RepeatMode;
  shuffle: boolean;
}

export const MAX_RESUME_QUEUE = 300;
const KEEP_BEFORE = 30;

const slim = (s: SongItem): SongItem => ({
  kind: 'song',
  id: s.id,
  title: s.title,
  artists: s.artists,
  album: s.album,
  durationText: s.durationText,
  durationSec: s.durationSec,
  thumbnail: s.thumbnail,
  explicit: s.explicit,
});

export function serializeResume(state: ResumeState): string {
  let { queue, index } = state;
  if (queue.length > MAX_RESUME_QUEUE) {
    // a very long queue (e.g. an endless radio): keep a window around the current song
    const start = Math.max(0, Math.min(index - KEEP_BEFORE, queue.length - MAX_RESUME_QUEUE));
    queue = queue.slice(start, start + MAX_RESUME_QUEUE);
    index -= start;
  }
  return JSON.stringify({
    v: 1,
    queue: queue.map(slim),
    index,
    position: Math.max(0, Math.round(state.position)),
    repeat: state.repeat,
    shuffle: state.shuffle,
  });
}

const isSong = (x: unknown): x is SongItem => {
  const s = x as Partial<SongItem> | null;
  return !!s && s.kind === 'song' && typeof s.id === 'string' && s.id !== '' && typeof s.title === 'string' && Array.isArray(s.artists);
};

export function parseResume(raw: string | null | undefined): ResumeState | null {
  if (!raw) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || !Array.isArray(data.queue)) return null;

  const wantedId = isSong(data.queue[Number(data.index)]) ? (data.queue[Number(data.index)] as SongItem).id : undefined;
  const queue = (data.queue as unknown[]).filter(isSong).slice(0, MAX_RESUME_QUEUE * 2);
  if (!queue.length) return null;

  // the index follows the song, even when unreadable entries before it were dropped
  let index = wantedId ? queue.findIndex((s) => s.id === wantedId) : -1;
  if (index < 0) index = Math.max(0, Math.min(queue.length - 1, Number.isFinite(Number(data.index)) ? Math.trunc(Number(data.index)) : 0));

  const position = Number(data.position);
  const repeat: RepeatMode = data.repeat === 'all' || data.repeat === 'one' ? data.repeat : 'off';
  return { queue, index, position: Number.isFinite(position) && position > 0 ? position : 0, repeat, shuffle: data.shuffle === true };
}

/** where to start: 0 for a barely started song, or one that was about to end */
export function startPosition(position: number, durationSec?: number): number {
  if (!Number.isFinite(position) || position < 3) return 0;
  if (durationSec && position > durationSec - 5) return 0;
  return Math.floor(position);
}
