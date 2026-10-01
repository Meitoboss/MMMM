import type {
  AlbumItem,
  AlbumRef,
  ArtistItem,
  ArtistRef,
  MusicItem,
  PlaylistItem,
  Section,
  SongItem,
  VideoItem,
} from '../types';
import {
  DURATION_RE,
  Json,
  Run,
  SEPARATOR,
  bestThumbnail,
  findContinuation,
  isAlbumEndpoint,
  isArtistEndpoint,
  isPlaylistEndpoint,
  parseDuration,
  runsText,
  splitBySeparator,
} from './helpers';

const EXPLICIT = 'MUSIC_EXPLICIT_BADGE';

function isExplicit(renderer: Json): boolean {
  return !!renderer?.badges?.some(
    (b: Json) => b?.musicInlineBadgeRenderer?.icon?.iconType === EXPLICIT,
  );
}

function artistsFromRuns(runs: Run[] = []): ArtistRef[] {
  const linked = runs.filter((r) => isArtistEndpoint(r.navigationEndpoint));
  if (linked.length > 0) {
    return linked.map((r) => ({
      id: r.navigationEndpoint?.browseEndpoint?.browseId,
      name: r.text ?? '',
    }));
  }
  return [];
}

function albumFromRuns(runs: Run[] = []): AlbumRef | undefined {
  const r = runs.find((x) => isAlbumEndpoint(x.navigationEndpoint));
  return r ? { id: r.navigationEndpoint?.browseEndpoint?.browseId, name: r.text ?? '' } : undefined;
}

function flexRuns(renderer: Json, col: number): Run[] {
  return renderer?.flexColumns?.[col]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
}

function rendererThumb(renderer: Json): string | undefined {
  return bestThumbnail(renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
}

function videoIdOf(renderer: Json): string | undefined {
  return (
    renderer?.playlistItemData?.videoId ??
    flexRuns(renderer, 0)[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId
  );
}

function musicVideoType(renderer: Json): string | undefined {
  const ep =
    flexRuns(renderer, 0)[0]?.navigationEndpoint?.watchEndpoint ??
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint;
  return ep?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
}

/**
 * Song row (search results, album/playlist/artist shelves).
 * Port of `SongItem.from(MusicResponsiveListItemRenderer)` and `AlbumPage.getSong`.
 */
export function songFromListItem(
  renderer: Json,
  fallback?: { album?: AlbumRef; thumbnail?: string; artists?: ArtistRef[] },
): SongItem | null {
  const id = videoIdOf(renderer);
  if (!id) return null;

  const title = flexRuns(renderer, 0)[0]?.text ?? '';
  const subtitleRuns = flexRuns(renderer, 1);
  let artists = artistsFromRuns(subtitleRuns);
  if (artists.length === 0) {
    // no links (e.g. uploaded tracks) -> take the text before the first separator
    const first = splitBySeparator(subtitleRuns)[0]?.map((r) => r.text ?? '').join('').trim();
    if (first) artists = [{ name: first }];
  }
  if (artists.length === 0 && fallback?.artists) artists = fallback.artists;

  // album is in column 2 (Kotlin: `albumRow = if (albumId == null) 3 else 2`), but also appears in col 1
  const album =
    albumFromRuns(flexRuns(renderer, 2)) ??
    albumFromRuns(flexRuns(renderer, 3)) ??
    albumFromRuns(subtitleRuns) ??
    fallback?.album;

  const durationText =
    renderer?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text ??
    renderer?.fixedColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ??
    [...subtitleRuns].reverse().find((r) => r.text && DURATION_RE.test(r.text))?.text;

  return {
    kind: 'song',
    id,
    title,
    artists,
    album,
    durationText,
    durationSec: parseDuration(durationText),
    thumbnail: rendererThumb(renderer) ?? fallback?.thumbnail,
    explicit: isExplicit(renderer),
    setVideoId: renderer?.playlistItemData?.playlistSetVideoId,
  };
}

/** `SongItem.from(PlaylistPanelVideoRenderer)` – used by `next` (queue / radio). */
export function songFromPanelVideo(renderer: Json): SongItem | null {
  const id: string | undefined = renderer?.navigationEndpoint?.watchEndpoint?.videoId ?? renderer?.videoId;
  if (!id) return null;
  const groups = splitBySeparator(renderer?.longBylineText?.runs ?? []);
  const artists = artistsFromRuns(groups[0] ?? []);
  const album = albumFromRuns(groups[1] ?? []);
  const durationText: string | undefined = renderer?.lengthText?.runs?.[0]?.text;
  return {
    kind: 'song',
    id,
    title: runsText(renderer?.title),
    artists: artists.length ? artists : (groups[0] ?? []).map((r) => ({ name: r.text ?? '' })).filter((a) => a.name),
    album,
    durationText,
    durationSec: parseDuration(durationText),
    thumbnail: bestThumbnail(renderer?.thumbnail?.thumbnails),
    explicit: isExplicit(renderer),
  };
}

function toVideo(id: string, title: string, artists: ArtistRef[], renderer: Json, vtype?: string): VideoItem {
  return {
    kind: 'video',
    id,
    title,
    artists,
    durationText: undefined,
    viewsText: undefined,
    thumbnail: rendererThumb(renderer),
    isOfficialMusicVideo: vtype === 'MUSIC_VIDEO_TYPE_OMV',
    isUserGeneratedContent: vtype === 'MUSIC_VIDEO_TYPE_UGC',
  };
}

/**
 * Classifies a `musicResponsiveListItemRenderer` into song / video / album / artist / playlist.
 * (Kotlin did this through separate search filters + `Endpoint` subclasses.)
 */
export function itemFromListItem(renderer: Json): MusicItem | null {
  if (!renderer) return null;

  const videoId = videoIdOf(renderer);
  if (videoId) {
    const vtype = musicVideoType(renderer);
    const song = songFromListItem(renderer);
    if (!song) return null;
    if (vtype === 'MUSIC_VIDEO_TYPE_OMV' || vtype === 'MUSIC_VIDEO_TYPE_UGC') {
      const v = toVideo(song.id, song.title, song.artists, renderer, vtype);
      v.durationText = song.durationText;
      return v;
    }
    return song;
  }

  const nav = renderer.navigationEndpoint;
  const browseId: string | undefined = nav?.browseEndpoint?.browseId;
  if (!browseId) return null;
  const title = flexRuns(renderer, 0)[0]?.text ?? '';
  const sub = flexRuns(renderer, 1);
  const thumbnail = rendererThumb(renderer);

  if (isAlbumEndpoint(nav)) {
    const yearRun = [...sub].reverse().find((r) => /^\d{4}$/.test((r.text ?? '').trim()));
    return {
      kind: 'album',
      id: browseId,
      title,
      artists: artistsFromRuns(sub),
      year: yearRun?.text,
      playlistId:
        renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
          ?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId,
      thumbnail,
    } satisfies AlbumItem;
  }
  if (isArtistEndpoint(nav)) {
    return {
      kind: 'artist',
      id: browseId,
      name: title,
      subscribersText: sub.length > 1 ? sub[sub.length - 1].text : undefined,
      thumbnail,
    } satisfies ArtistItem;
  }
  if (isPlaylistEndpoint(nav)) {
    const count = sub.map((r) => r.text ?? '').map((t) => t.match(/^(\d[\d,.]*)\s/)).find(Boolean);
    const channel = artistsFromRuns(sub)[0] ?? undefined;
    return {
      kind: 'playlist',
      id: browseId,
      title,
      channel,
      songCount: count ? parseInt(count[1].replace(/[,.]/g, ''), 10) : undefined,
      thumbnail,
    } satisfies PlaylistItem;
  }
  return null;
}

/** Port of `FromMusicTwoRowItemRenderer.kt` (home shelves, artist page carousels, new releases…) */
export function itemFromTwoRow(renderer: Json): MusicItem | null {
  if (!renderer) return null;
  const titleRun: Run | undefined = renderer.title?.runs?.[0];
  const title = titleRun?.text ?? '';
  const thumbnail = bestThumbnail(renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  const subRuns: Run[] = renderer.subtitle?.runs ?? [];
  const nav = renderer.navigationEndpoint ?? titleRun?.navigationEndpoint;

  const watch = nav?.watchEndpoint;
  if (watch?.videoId) {
    const vtype = watch.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
    const artists = artistsFromRuns(subRuns);
    const fallbackArtists = artists.length
      ? artists
      : subRuns
          .map((r) => r.text ?? '')
          .filter((t) => t && t !== SEPARATOR)
          .slice(0, 1)
          .map((name) => ({ name }));
    if (vtype === 'MUSIC_VIDEO_TYPE_ATV') {
      return {
        kind: 'song',
        id: watch.videoId,
        title,
        artists: fallbackArtists,
        thumbnail,
        explicit: isExplicit(renderer),
      };
    }
    return {
      kind: 'video',
      id: watch.videoId,
      title,
      artists: fallbackArtists,
      thumbnail,
      isOfficialMusicVideo: vtype === 'MUSIC_VIDEO_TYPE_OMV',
      isUserGeneratedContent: vtype === 'MUSIC_VIDEO_TYPE_UGC',
    };
  }

  const browseId: string | undefined = nav?.browseEndpoint?.browseId;
  if (!browseId) return null;

  if (isAlbumEndpoint(nav)) {
    const yearRun = [...subRuns].reverse().find((r) => /^\d{4}$/.test((r.text ?? '').trim()));
    return {
      kind: 'album',
      id: browseId,
      title,
      artists: artistsFromRuns(subRuns),
      year: yearRun?.text ?? subRuns[subRuns.length - 1]?.text,
      playlistId:
        renderer.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
          ?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId,
      thumbnail,
    };
  }
  if (isArtistEndpoint(nav)) {
    return {
      kind: 'artist',
      id: browseId,
      name: title,
      subscribersText: subRuns[subRuns.length - 1]?.text,
      thumbnail,
    };
  }
  if (isPlaylistEndpoint(nav)) {
    const count = subRuns.map((r) => (r.text ?? '').match(/^(\d[\d,.]*)\s/)).find(Boolean);
    return {
      kind: 'playlist',
      id: browseId,
      title,
      channel: artistsFromRuns(subRuns)[0],
      songCount: count ? parseInt(count[1].replace(/[,.]/g, ''), 10) : undefined,
      thumbnail,
    };
  }
  return null;
}

/** A shelf content entry is either a two-row card or a responsive list row. */
export function itemFromShelfContent(content: Json): MusicItem | null {
  if (content?.musicTwoRowItemRenderer) return itemFromTwoRow(content.musicTwoRowItemRenderer);
  if (content?.musicResponsiveListItemRenderer) return itemFromListItem(content.musicResponsiveListItemRenderer);
  return null;
}

/** `musicCarouselShelfRenderer` -> Section */
export function sectionFromCarousel(shelf: Json): Section | null {
  const header = shelf?.header?.musicCarouselShelfBasicHeaderRenderer;
  const title = runsText(header?.title);
  const items = (shelf?.contents ?? [])
    .map(itemFromShelfContent)
    .filter((x: MusicItem | null): x is MusicItem => !!x);
  if (items.length === 0) return null;
  const more = header?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint;
  return { title, items, moreBrowseId: more?.browseId, moreParams: more?.params };
}

/** `musicShelfRenderer` -> Section */
export function sectionFromMusicShelf(shelf: Json): Section | null {
  const items = (shelf?.contents ?? [])
    .map(itemFromShelfContent)
    .filter((x: MusicItem | null): x is MusicItem => !!x);
  if (items.length === 0) return null;
  const more = shelf?.bottomEndpoint?.browseEndpoint ?? shelf?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
  return {
    title: runsText(shelf?.title),
    items,
    moreBrowseId: more?.browseId,
    moreParams: more?.params,
  };
}

export function sectionsFromSectionList(sectionList: Json): Section[] {
  const out: Section[] = [];
  for (const c of sectionList?.contents ?? []) {
    const s = c.musicCarouselShelfRenderer
      ? sectionFromCarousel(c.musicCarouselShelfRenderer)
      : c.musicShelfRenderer
        ? sectionFromMusicShelf(c.musicShelfRenderer)
        : null;
    if (s) out.push(s);
  }
  return out;
}

export { findContinuation };
