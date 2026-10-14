import Storage from 'expo-sqlite/kv-store';

import { yt } from '../core';
import { isLocalId } from '../core/localMeta';
import { TASTE_SEEDS, isFresh, mixRadios, topArtists } from '../core/taste';
import type { ArtistItem, SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

const KEY = 'taste.mix.v1';
export interface TasteMix {
  songs: SongItem[];
  artists: ArtistItem[];
}
type Saved = TasteMix & { at: number };

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

/** the artists' pictures come from their own pages (the same as on an artist's screen); a missing picture is fine */
async function withPictures(list: { id: string; name: string }[]): Promise<ArtistItem[]> {
  const pages = await Promise.allSettled(list.map((a) => yt.artist(a.id)));
  return list.map((a, i) => {
    const page = pages[i];
    return { kind: 'artist' as const, id: a.id, name: a.name, thumbnail: page.status === 'fulfilled' ? page.value.thumbnail : undefined };
  });
}

async function buildMix(): Promise<TasteMix> {
  const db = await openDb();
  const seeds = (await repo.topSongs(db, 'all', 20)).map((t) => t.song).filter((s) => !isLocalId(s.id)).slice(0, TASTE_SEEDS);
  if (!seeds.length) return { songs: [], artists: [] };
  const results = await Promise.allSettled(seeds.map((s) => yt.radio(s.id)));
  const radios = results.map((r) => (r.status === 'fulfilled' ? r.value.songs : []));
  const songs = mixRadios(seeds.map((s) => s.id), radios);
  return { songs, artists: await withPictures(topArtists(songs)) };
}

let inflight: Promise<TasteMix> | null = null;

/**
 * The home screen's taste: the songs (radios of the most played YouTube songs, mixed) and the artists that come up most in them.
 * Saved for a day; `force` makes it again. When the network fails, the last saved one is kept.
 */
export function getTaste(force = false): Promise<TasteMix> {
  const saved = readSaved();
  const fallback: TasteMix = { songs: saved?.songs ?? [], artists: saved?.artists ?? [] };
  if (!force && saved && isFresh(saved.at, Date.now())) return Promise.resolve(fallback);
  if (!inflight) {
    inflight = buildMix()
      .then((mix) => {
        if (mix.songs.length) {
          writeSaved({ at: Date.now(), ...mix });
          return mix;
        }
        return fallback;
      })
      .catch(() => fallback)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function getTasteMix(force = false): Promise<SongItem[]> {
  return (await getTaste(force)).songs;
}
