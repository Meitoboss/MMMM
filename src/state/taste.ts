import Storage from 'expo-sqlite/kv-store';

import { yt } from '../core';
import { isLocalId } from '../core/localMeta';
import { TASTE_SEEDS, isFresh, mixRadios } from '../core/taste';
import type { SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

const KEY = 'taste.mix.v1';
type Saved = { at: number; songs: SongItem[] };

function readSaved(): Saved | null {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(v: Saved): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(v));
  } catch {
    /* saving is best effort: the mix is simply made again next time */
  }
}

async function buildMix(): Promise<SongItem[]> {
  const db = await openDb();
  const seeds = (await repo.topSongs(db, 'all', 20)).map((t) => t.song).filter((s) => !isLocalId(s.id)).slice(0, TASTE_SEEDS);
  if (!seeds.length) return [];
  const results = await Promise.allSettled(seeds.map((s) => yt.radio(s.id)));
  const radios = results.map((r) => (r.status === 'fulfilled' ? r.value.songs : []));
  return mixRadios(seeds.map((s) => s.id), radios);
}

let inflight: Promise<SongItem[]> | null = null;

/**
 * The "よく聴く曲からのおすすめ" songs: the radios of the most played YouTube songs, mixed. A saved mix is used for a day;
 * `force` makes it again. When the network fails, the last saved mix is kept.
 */
export function getTasteMix(force = false): Promise<SongItem[]> {
  const saved = readSaved();
  if (!force && saved && isFresh(saved.at, Date.now())) return Promise.resolve(saved.songs);
  if (!inflight) {
    inflight = buildMix()
      .then((songs) => {
        if (songs.length) {
          writeSaved({ at: Date.now(), songs });
          return songs;
        }
        return saved?.songs ?? [];
      })
      .catch(() => saved?.songs ?? [])
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
