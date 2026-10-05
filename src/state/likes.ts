import { useEffect, useState } from 'react';
import { create } from 'zustand';

import type { SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

/** counts every like / un-like, anywhere in the app, so that all hearts (mini player, player, menus) redraw together */
export const useLikes = create<{ version: number }>(() => ({ version: 0 }));

/** the one place that toggles a favourite; returns the new state */
export async function toggleLikeSong(song: SongItem): Promise<boolean> {
  const liked = await repo.toggleLike(await openDb(), song);
  useLikes.setState((s) => ({ version: s.version + 1 }));
  return liked;
}

/** whether a song is a favourite – follows changes made anywhere */
export function useIsLiked(songId: string | undefined): boolean {
  const version = useLikes((s) => s.version);
  const [liked, setLiked] = useState(false);
  useEffect(() => {
    if (!songId) {
      setLiked(false);
      return;
    }
    let on = true;
    openDb()
      .then((db) => repo.isLiked(db, songId))
      .then((v) => on && setLiked(v))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [songId, version]);
  return liked;
}
