import Storage from 'expo-sqlite/kv-store';

import { yt } from '../core';
import { RELEASE_ARTISTS, RELEASES_PER_ARTIST } from '../core/homeMemory';
import { isFresh } from '../core/taste';
import type { AlbumItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';

const KEY = 'home.newReleases.v1';
const MAX = 12;
/** the sections of an artist's page that hold albums and singles */
const RELEASE_SECTION = /アルバム|シングル|Album|Single|EP/i;

type Saved = { at: number; albums: AlbumItem[] };

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
    /* best effort */
  }
}

/** albums and singles of the bookmarked artists (their own pages), newest sections first as YouTube lists them; kept for a day */
export async function getNewReleases(force = false): Promise<AlbumItem[]> {
  const saved = readSaved();
  if (!force && saved && isFresh(saved.at, Date.now())) return saved.albums;
  try {
    const db = await openDb();
    const artists = (await repo.bookmarkedArtists(db)).slice(0, RELEASE_ARTISTS);
    const pages = await Promise.allSettled(artists.map((a) => yt.artist(a.id)));
    const seen = new Set<string>();
    const albums: AlbumItem[] = [];
    for (const page of pages) {
      if (page.status !== 'fulfilled') continue;
      const found = page.value.sections
        .filter((sec) => RELEASE_SECTION.test(sec.title))
        .flatMap((sec) => sec.items.filter((i): i is AlbumItem => i.kind === 'album'))
        .slice(0, RELEASES_PER_ARTIST);
      for (const a of found) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        albums.push(a);
      }
    }
    const result = albums.slice(0, MAX);
    writeSaved({ at: Date.now(), albums: result });
    return result;
  } catch {
    return saved?.albums ?? [];
  }
}
