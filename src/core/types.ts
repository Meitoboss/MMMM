/**
 * Shared item models.
 * Ported from `Environment.SongItem / AlbumItem / ArtistItem / PlaylistItem / VideoItem`
 * (extensions/environment/.../Environment.kt).
 */

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface ArtistRef {
  /** YouTube Music browseId (UC... / MPLA...) – may be missing for plain-text artists */
  id?: string;
  name: string;
}

export interface AlbumRef {
  id?: string;
  name: string;
}

export interface SongItem {
  kind: 'song';
  /** videoId */
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef;
  durationText?: string;
  durationSec?: number;
  thumbnail?: string;
  explicit: boolean;
  setVideoId?: string;
}

export interface VideoItem {
  kind: 'video';
  id: string;
  title: string;
  artists: ArtistRef[];
  viewsText?: string;
  durationText?: string;
  thumbnail?: string;
  isOfficialMusicVideo: boolean;
  isUserGeneratedContent: boolean;
}

export interface AlbumItem {
  kind: 'album';
  /** browseId (MPREb_...) */
  id: string;
  title: string;
  artists: ArtistRef[];
  year?: string;
  playlistId?: string;
  thumbnail?: string;
}

export interface ArtistItem {
  kind: 'artist';
  id: string;
  name: string;
  subscribersText?: string;
  thumbnail?: string;
}

export interface PlaylistItem {
  kind: 'playlist';
  /** browseId (VL...) */
  id: string;
  title: string;
  channel?: ArtistRef;
  songCount?: number;
  thumbnail?: string;
}

export type MusicItem = SongItem | VideoItem | AlbumItem | ArtistItem | PlaylistItem;

export interface ItemsPage<T> {
  items: T[];
  continuation?: string;
}

export interface Section {
  title: string;
  items: MusicItem[];
  /** browse endpoint behind the "More" button, if any */
  moreBrowseId?: string;
  moreParams?: string;
}

export interface HomePage {
  sections: Section[];
  continuation?: string;
}

export interface PlaylistPage {
  id: string;
  title: string;
  author?: ArtistRef;
  description?: string;
  year?: string;
  thumbnail?: string;
  /** playlistId usable with `next` (OLAK5uy_... / PL... / RDCLAK...) */
  playlistId?: string;
  isEditable: boolean;
  songs: SongItem[];
  continuation?: string;
}

export interface ArtistPage {
  id: string;
  name: string;
  description?: string;
  subscribersText?: string;
  thumbnail?: string;
  shuffleVideoId?: string;
  shufflePlaylistId?: string;
  radioPlaylistId?: string;
  sections: Section[];
}

export interface NextPage {
  songs: SongItem[];
  continuation?: string;
  playlistId?: string;
  params?: string;
}

export interface SearchSuggestions {
  queries: string[];
  recommended: MusicItem[];
}

export type SearchFilter =
  | 'song'
  | 'video'
  | 'album'
  | 'artist'
  | 'community_playlist'
  | 'featured_playlist'
  | 'podcast';

/** Values copied from `Environment.SearchFilter` */
export const SEARCH_FILTER_PARAMS: Record<SearchFilter, string> = {
  song: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  video: 'EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D',
  album: 'EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D',
  artist: 'EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D',
  community_playlist: 'EgeKAQQoAEABagoQAxAEEAoQCRAF',
  featured_playlist: 'EgeKAQQoADgBagwQDhAKEAMQBRAJEAQ%3D',
  podcast: 'EgWKAQJQAWoIEBAQERADEBU%3D',
};

export interface LyricLine {
  /** milliseconds */
  time: number;
  text: string;
}

export interface Lyrics {
  source: 'lrclib' | 'kugou';
  synced: boolean;
  lines: LyricLine[];
  plain?: string;
}

export interface AudioSource {
  url: string;
  mimeType?: string;
  bitrate?: number;
  itag?: number;
  contentLength?: number;
  /** Where the URL came from, for debugging */
  via: 'piped' | 'invidious' | 'innertube';
  expiresAt?: number;
}
