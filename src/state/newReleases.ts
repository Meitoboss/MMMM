import Storage from 'expo-sqlite/kv-store';

import { yt } from '../core';
import { RELEASE_ARTISTS, RELEASES_PER_ARTIST } from '../core/homeMemory';
import { isLocalId } from '../core/localMeta';
import { isFresh, topArtists } from '../core/taste';
import type { AlbumItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { getTaste } from './taste';

const KEY = 'home.newReleases.v2';
/** the sections of an artist's page that hold albums and singles */
const RELEASE_SECTION = /アルバム|シングル|Album|Single|EP/i;

export interface ReleaseGroups {
  /** the artists you bookmarked */
  bookmarked: AlbumItem[];
  /** artists of the songs you play most */
  listened: AlbumItem[];
  /** the artists recommended from your taste */
  recommended: AlbumItem[];
}

type Saved = ReleaseGroups & { at: number };

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

/** the albums and singles of these artists' own pages (a few per artist) */
async function releasesOf(artists: { id: string }[]): Promise<AlbumItem[]> {
  const pages = await Promise.allSettled(artists.map((a) => yt.artist(a.id)));
  const out: AlbumItem[] = [];
  for (const page of pages) {
    if (page.status !== 'fulfilled') continue;
    out.push(
      ...page.value.sections
        .filter((sec) => RELEASE_SECTION.test(sec.title))
        .flatMap((sec) => sec.items.filter((i): i is AlbumItem => i.kind === 'album'))
        .slice(0, RELEASES_PER_ARTIST),
    );
  }
  return out;
}

/**
 * The 新着 tab: new albums and singles of the artists around your bookmarks. Each group is kept for a day, and an artist
 * appears in one group only. When the network fails, the last saved groups are kept.
 */
export async function getReleaseGroups(force = false): Promise<ReleaseGroups> {
  const saved = readSaved();
  const kept: ReleaseGroups = { bookmarked: saved?.bookmarked ?? [], listened: saved?.listened ?? [], recommended: saved?.recommended ?? [] };
  if (!force && saved && isFresh(saved.at, Date.now())) return kept;
  try {
    const db = await openDb();
    const bookmarked = (await repo.bookmarkedArtists(db)).slice(0, RELEASE_ARTISTS);
    const taken = new Set(bookmarked.map((a) => a.id));
    const top = (await repo.topSongs(db, 'all', 30)).map((t) => t.song).filter((s) => !isLocalId(s.id));
    const listened = topArtists(top).filter((a) => !taken.has(a.id)).slice(0, RELEASE_ARTISTS);
    listened.forEach((a) => taken.add(a.id));
    const taste = (await getTaste()).artists.filter((a) => !taken.has(a.id)).slice(0, RELEASE_ARTISTS);

    const mix: ReleaseGroups = {
      bookmarked: await releasesOf(bookmarked),
      listened: await releasesOf(listened),
      recommended: await releasesOf(taste),
    };
    writeSaved({ at: Date.now(), ...mix });
    return mix;
  } catch {
    return kept;
  }
}
