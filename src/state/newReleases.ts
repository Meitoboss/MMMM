import Storage from 'expo-sqlite/kv-store';

import { yt } from '../core';
import { RELEASE_ARTISTS, RELEASES_PER_ARTIST } from '../core/homeMemory';
import { isLocalId } from '../core/localMeta';
import { isFresh, topArtists } from '../core/taste';
import type { AlbumItem, SongItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { getTaste } from './taste';

const KEY = 'home.newReleases.v3';
/** the sections of an artist's page that hold albums and singles */
const RELEASE_SECTION = /アルバム|シングル|Album|Single|EP/i;
/** new songs: the songs of the newest album of each artist, this many albums and songs at most */
const SONG_ALBUMS = 6;
const SONGS_PER_ALBUM = 6;
const SONGS_MAX = 24;

export interface ReleaseGroups {
  /** albums and singles of the artists you bookmarked */
  bookmarked: AlbumItem[];
  /** albums and singles of the artists you listen to most and of the recommended artists */
  others: AlbumItem[];
  /** songs of the newest albums of the bookmarked artists */
  bookmarkedSongs: SongItem[];
  /** songs of the newest albums of the other artists */
  otherSongs: SongItem[];
}

const EMPTY: ReleaseGroups = { bookmarked: [], others: [], bookmarkedSongs: [], otherSongs: [] };

type Saved = ReleaseGroups & { at: number };

export function cachedReleaseGroups(): ReleaseGroups {
  try {
    const raw = Storage.getItemSync(KEY);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved ? { bookmarked: saved.bookmarked, others: saved.others, bookmarkedSongs: saved.bookmarkedSongs, otherSongs: saved.otherSongs } : EMPTY;
  } catch {
    return EMPTY;
  }
}

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

/** the first (newest, as YouTube lists them) album of each artist, at most `max` */
function newestPerArtist(albums: AlbumItem[], max: number): AlbumItem[] {
  const seen = new Set<string>();
  const out: AlbumItem[] = [];
  for (const a of albums) {
    const artist = a.artists[0]?.id ?? a.id;
    if (seen.has(artist)) continue;
    seen.add(artist);
    out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

/** the songs of these albums, each song once */
async function songsOf(albums: AlbumItem[]): Promise<SongItem[]> {
  const pages = await Promise.allSettled(albums.map((a) => yt.album(a.id)));
  const seen = new Set<string>();
  const out: SongItem[] = [];
  for (const page of pages) {
    if (page.status !== 'fulfilled') continue;
    for (const song of page.value.songs.slice(0, SONGS_PER_ALBUM)) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      out.push(song);
    }
  }
  return out.slice(0, SONGS_MAX);
}

/**
 * The 新着 tab: new albums, singles and songs of the artists around your bookmarks. The bookmarked artists come first.
 * Kept for a day; when the network fails, the last saved groups are kept.
 */
export async function getReleaseGroups(force = false): Promise<ReleaseGroups> {
  const saved = readSaved();
  if (!force && saved && isFresh(saved.at, Date.now())) return cachedReleaseGroups();
  try {
    const db = await openDb();
    const bookmarked = (await repo.bookmarkedArtists(db)).slice(0, RELEASE_ARTISTS);
    const taken = new Set(bookmarked.map((a) => a.id));
    const top = (await repo.topSongs(db, 'all', 30)).map((t) => t.song).filter((s) => !isLocalId(s.id));
    const listened = topArtists(top).filter((a) => !taken.has(a.id)).slice(0, RELEASE_ARTISTS);
    listened.forEach((a) => taken.add(a.id));
    const taste = (await getTaste()).artists.filter((a) => !taken.has(a.id)).slice(0, RELEASE_ARTISTS);

    const bookmarkedAlbums = await releasesOf(bookmarked);
    const otherAlbums = [...(await releasesOf(listened)), ...(await releasesOf(taste))];
    const mix: Saved = {
      at: Date.now(),
      bookmarked: bookmarkedAlbums,
      others: otherAlbums,
      bookmarkedSongs: await songsOf(newestPerArtist(bookmarkedAlbums, SONG_ALBUMS)),
      otherSongs: await songsOf(newestPerArtist(otherAlbums, SONG_ALBUMS)),
    };
    writeSaved(mix);
    return cachedReleaseGroups();
  } catch {
    return cachedReleaseGroups();
  }
}
