import { useCallback, useEffect, useState } from 'react';

import type { BpmInfo } from '../core/beat';
import type { SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

/** the tempo (BPM) of a song, and a way to change it */
export function useSongBpm(song: SongItem | null | undefined) {
  const [info, setInfo] = useState<BpmInfo | null>(null);
  const id = song?.id;

  useEffect(() => {
    setInfo(null);
    if (!id) return;
    let on = true;
    openDb()
      .then((db) => repo.bpmOf(db, id))
      .then((v) => on && setInfo(v))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [id]);

  /** null removes it; returns what was saved */
  const save = useCallback(
    async (next: BpmInfo | null): Promise<BpmInfo | null> => {
      if (!song) return null;
      const saved = await repo.setBpm(await openDb(), song, next);
      setInfo(saved);
      return saved;
    },
    [song],
  );
  return { info, save };
}

/** the tempo of another song (the next one in the queue), read only */
export function useBpmOf(song: SongItem | null | undefined): BpmInfo | null {
  const [info, setInfo] = useState<BpmInfo | null>(null);
  const id = song?.id;
  useEffect(() => {
    setInfo(null);
    if (!id) return;
    let on = true;
    openDb()
      .then((db) => repo.bpmOf(db, id))
      .then((v) => on && setInfo(v))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [id]);
  return info;
}
