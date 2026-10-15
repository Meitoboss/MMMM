import Storage from 'expo-sqlite/kv-store';

import { yt } from '../core';
import { RELEASE_ARTISTS, RELEASES_PER_ARTIST } from '../core/homeMemory';
import { isLocalId } from '../core/localMeta';
import { isFresh, topArtists } from '../core/taste';
import type { AlbumItem, SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { getTaste } from './taste';

const KEY = 'home.newReleases.v5';
/** the sections of an artist's page that hold albums and singles */
const RELEASE_SECTION = /アルバム|シングル|Album|Single|EP/i;
/** songs taken from the newest album of each artist */
const SONGS_PER_ARTIST = 6;
/** how many artists that are not bookmarked get a shelf on 新着 */
const OTHER_ARTISTS = 12;

/** the new things of one artist: the songs of its newest album, then its albums and singles */
export interface ArtistReleases {
  id: string;
  name: string;
  items: (SongItem | AlbumItem)[];
}

export interface ReleaseGroups {
  /** the artists you bookmarked, in the order you bookmarked them */
  bookmarked: ArtistReleases[];
  /** the artists you listen to most and the recommended ones */
  others: ArtistReleases[];
}

const EMPTY: ReleaseGroups = { bookmarked: [], others: [] };

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

/** the saved groups (empty when nothing has been saved yet) */
export function cachedReleaseGroups(): ReleaseGroups {
  const saved = readSaved();
  return saved ? { bookmarked: saved.bookmarked, others: saved.others } : EMPTY;
}

/** one artist's page: its albums and singles, and the songs of the newest one */
async function releasesForArtist(a: { id: string; name: string }): Promise<ArtistReleases> {
  const page = await yt.artist(a.id);
  const albums = page.sections
    .filter((sec) => RELEASE_SECTION.test(sec.title))
    .flatMap((sec) => sec.items.filter((i): i is AlbumItem => i.kind === 'album'))
    .slice(0, RELEASES_PER_ARTIST);
  let songs: SongItem[] = [];
  const newest = albums[0];
  if (newest) {
    try {
      songs = (await yt.album(newest.id)).songs.slice(0, SONGS_PER_ARTIST);
    } catch {
      /* the album's songs are optional */
    }
  }
  return { id: a.id, name: a.name, items: [...songs, ...albums] };
}

async function releasesFor(artists: { id: string; name: string }[]): Promise<ArtistReleases[]> {
  const results = await Promise.allSettled(artists.map(releasesForArtist));
  return results.flatMap((r) => (r.status === 'fulfilled' && r.value.items.length ? [r.value] : []));
}

/**
 * The 新着 tab, one shelf per artist: the artists you bookmarked first, then the ones you listen to most and the recommended
 * ones. Kept for a day; when the network fails, the last saved groups are kept.
 */
export async function getReleaseGroups(force = false): Promise<ReleaseGroups> {
  const saved = readSaved();
  if (!force && saved && isFresh(saved.at, Date.now())) return cachedReleaseGroups();
  try {
    const db = await openDb();
    const bookmarked = (await repo.bookmarkedArtists(db)).slice(0, RELEASE_ARTISTS).map((a) => ({ id: a.id, name: a.name }));
    const taken = new Set(bookmarked.map((a) => a.id));
    // the artists you listen to and like (not only the bookmarked ones), then the recommended ones
    const top = (await repo.topSongs(db, 'all', 30)).map((t) => t.song).filter((s) => !isLocalId(s.id));
    const liked = (await repo.libraryList(db, 'liked', 'title')).slice(0, 60);
    const listened = topArtists([...top, ...liked]).filter((a) => !taken.has(a.id)).slice(0, OTHER_ARTISTS);
    listened.forEach((a) => taken.add(a.id));
    const taste = (await getTaste()).artists.filter((a) => !taken.has(a.id)).map((a) => ({ id: a.id, name: a.name }));

    const mix: Saved = {
      at: Date.now(),
      bookmarked: await releasesFor(bookmarked),
      others: await releasesFor([...listened, ...taste].slice(0, OTHER_ARTISTS)),
    };
    writeSaved(mix);
    return cachedReleaseGroups();
  } catch {
    return cachedReleaseGroups();
  }
}
