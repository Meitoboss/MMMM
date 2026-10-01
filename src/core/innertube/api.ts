import type {
  AlbumRef,
  ArtistPage,
  ArtistRef,
  HomePage,
  ItemsPage,
  MusicItem,
  NextPage,
  PlaylistPage,
  SearchFilter,
  SearchSuggestions,
  SongItem,
} from '../types';
import { SEARCH_FILTER_PARAMS } from '../types';
import { post } from './client';
import {
  Json,
  bestThumbnail,
  findContinuation,
  isArtistEndpoint,
  runsText,
  splitBySeparator,
} from './helpers';
import {
  itemFromListItem,
  itemFromShelfContent,
  sectionsFromSectionList,
  songFromListItem,
  songFromPanelVideo,
} from './parsers';

/* ------------------------------------------------------------------ *
 * Search  (requests/SearchPage.kt, SearchSuggestions.kt)
 * ------------------------------------------------------------------ */

function itemsFromShelf(shelf: Json): ItemsPage<MusicItem> {
  const items: MusicItem[] = [];
  for (const c of shelf?.contents ?? []) {
    const it = c.musicResponsiveListItemRenderer ? itemFromListItem(c.musicResponsiveListItemRenderer) : null;
    if (it) items.push(it);
  }
  return { items, continuation: findContinuation(shelf) };
}

export async function search(query: string, filter?: SearchFilter): Promise<ItemsPage<MusicItem>> {
  const res = await post('search', {
    query,
    params: filter ? SEARCH_FILTER_PARAMS[filter] : undefined,
  });
  const sections: Json[] =
    res?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

  // filtered search -> one shelf; unfiltered -> several ("Top result", "Songs", "Albums" …)
  const merged: ItemsPage<MusicItem> = { items: [], continuation: undefined };
  const seen = new Set<string>();
  for (const s of sections) {
    const shelf = s.musicShelfRenderer ?? s.musicCardShelfRenderer;
    if (!shelf) continue;
    const page = itemsFromShelf(shelf);
    for (const it of page.items) {
      const key = `${it.kind}:${it.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.items.push(it);
      }
    }
    merged.continuation = page.continuation ?? merged.continuation;
  }
  return merged;
}

export async function searchContinuation(continuation: string): Promise<ItemsPage<MusicItem>> {
  const res = await post('search', { continuation }, { query: { continuation, ctoken: continuation, type: 'next' } });
  return itemsFromShelf(res?.continuationContents?.musicShelfContinuation);
}

export async function searchSuggestions(input: string): Promise<SearchSuggestions> {
  const res = await post('music/get_search_suggestions', { input });
  const queries: string[] = [];
  const recommended: MusicItem[] = [];
  for (const section of res?.contents ?? []) {
    for (const c of section?.searchSuggestionsSectionRenderer?.contents ?? []) {
      const sug = c.searchSuggestionRenderer;
      if (sug) {
        const text = sug.suggestion?.runs ? runsText(sug.suggestion) : sug.navigationEndpoint?.searchEndpoint?.query;
        if (text) queries.push(text);
      } else if (c.musicResponsiveListItemRenderer) {
        const it = itemFromListItem(c.musicResponsiveListItemRenderer);
        if (it) recommended.push(it);
      }
    }
  }
  return { queries, recommended };
}

/* ------------------------------------------------------------------ *
 * Next / queue / radio  (requests/NextPage.kt, RelatedSongs.kt)
 * ------------------------------------------------------------------ */

export interface NextBody {
  videoId?: string;
  playlistId?: string;
  params?: string;
  index?: number;
  playlistSetVideoId?: string;
}

function songsFromPanel(panel: Json): { songs: SongItem[]; continuation?: string } {
  const songs: SongItem[] = [];
  for (const c of panel?.contents ?? []) {
    const r = c.playlistPanelVideoRenderer ?? c.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    const s = r ? songFromPanelVideo(r) : null;
    if (s) songs.push(s);
  }
  return { songs, continuation: panel?.continuations?.[0]?.nextContinuationData?.continuation };
}

export async function next(body: NextBody): Promise<NextPage> {
  const res = await post('next', { ...body, isAudioOnly: true });
  const panel =
    res?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;

  // Like Kotlin: with no playlistId, follow the "automix" preview to get the real radio playlist.
  if (!body.playlistId) {
    const last = panel?.contents?.[panel.contents.length - 1];
    const ep = last?.automixPreviewVideoRenderer?.content?.automixPlaylistVideoRenderer?.navigationEndpoint?.watchPlaylistEndpoint;
    if (ep?.playlistId) return next({ ...body, playlistId: ep.playlistId, params: ep.params });
  }

  const { songs, continuation } = songsFromPanel(panel);
  return { songs, continuation, playlistId: body.playlistId, params: body.params };
}

export async function nextContinuation(continuation: string): Promise<{ songs: SongItem[]; continuation?: string }> {
  const res = await post('next', { continuation }, { query: { continuation, ctoken: continuation, type: 'next' } });
  return songsFromPanel(res?.continuationContents?.playlistPanelContinuation);
}

/** Radio / related queue for a song – `RDAMVM<videoId>` is the "song radio" playlist. */
export function radio(videoId: string): Promise<NextPage> {
  return next({ videoId, playlistId: `RDAMVM${videoId}`, params: 'wAEB' });
}

/* ------------------------------------------------------------------ *
 * Browse: home, album, playlist, artist  (requests/HomePage.kt, AlbumPage.kt, PlaylistPage.kt, ArtistPage.kt)
 * ------------------------------------------------------------------ */

function singleColumnSectionList(res: Json): Json {
  return (
    res?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer ??
    res?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
  );
}

export async function home(): Promise<HomePage> {
  const res = await post('browse', { browseId: 'FEmusic_home' });
  const list = singleColumnSectionList(res);
  return { sections: sectionsFromSectionList(list), continuation: findContinuation(list) };
}

export async function homeContinuation(continuation: string): Promise<HomePage> {
  const res = await post('browse', {}, { query: { continuation, ctoken: continuation, type: 'next' } });
  const list = res?.continuationContents?.sectionListContinuation;
  return { sections: sectionsFromSectionList(list), continuation: findContinuation(list) };
}

/** Generic browse (used by "More" buttons on shelves) */
export async function browseSections(browseId: string, params?: string) {
  const res = await post('browse', { browseId, params });
  const list = singleColumnSectionList(res);
  const header = res?.header?.musicHeaderRenderer ?? res?.header?.musicSideAlignedItemRenderer;
  const grid = list?.contents?.[0]?.gridRenderer;
  const items: MusicItem[] = [];
  for (const it of grid?.items ?? []) {
    const m = itemFromShelfContent(it);
    if (m) items.push(m);
  }
  const sections = sectionsFromSectionList(list);
  if (items.length) sections.unshift({ title: runsText(header?.title), items });
  return { title: runsText(header?.title), sections };
}

function playlistHeader(res: Json): Json {
  const tab = res?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
    ?.contents?.[0];
  return (
    tab?.musicResponsiveHeaderRenderer ??
    res?.header?.musicDetailHeaderRenderer ??
    res?.header?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicDetailHeaderRenderer ??
    res?.header?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicResponsiveHeaderRenderer ??
    res?.header?.musicResponsiveHeaderRenderer
  );
}

function playlistShelf(res: Json): Json {
  const two = res?.contents?.twoColumnBrowseResultsRenderer;
  const candidates: Json[] = [
    ...(two?.secondaryContents?.sectionListRenderer?.contents ?? []),
    ...(two?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? []),
    ...(res?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents ?? []),
  ];
  for (const c of candidates) {
    if (c?.musicPlaylistShelfRenderer) return c.musicPlaylistShelfRenderer;
    if (c?.musicShelfRenderer) return c.musicShelfRenderer;
  }
  return undefined;
}

function headerArtists(header: Json): ArtistRef[] {
  const strap = header?.straplineTextOne?.runs ?? [];
  const fromStrap = strap
    .filter((r: Json) => r.text && r.text !== ' • ' && r.text.trim() !== '&' && r.text !== ', ')
    .map((r: Json) => ({ id: r.navigationEndpoint?.browseEndpoint?.browseId, name: r.text }));
  if (fromStrap.length) return fromStrap;
  const sub = header?.subtitle?.runs ?? [];
  return sub
    .filter((r: Json) => isArtistEndpoint(r.navigationEndpoint))
    .map((r: Json) => ({ id: r.navigationEndpoint?.browseEndpoint?.browseId, name: r.text }));
}

function parsePlaylistLike(res: Json, browseId: string, isAlbum: boolean): PlaylistPage {
  const header = playlistHeader(res);
  const subtitleRuns: Json[] = header?.subtitle?.runs ?? [];
  const lastRun = subtitleRuns[subtitleRuns.length - 1]?.text;
  const thumbnail = bestThumbnail(
    header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      header?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ??
      res?.background?.musicThumbnailRenderer?.thumbnail?.thumbnails,
  );
  const artists = headerArtists(header);
  const albumRef: AlbumRef | undefined = isAlbum ? { id: browseId, name: runsText(header?.title) } : undefined;

  const canonical: string | undefined = res?.microformat?.microformatDataRenderer?.urlCanonical;
  const playlistId = isAlbum
    ? canonical?.split('=').pop() ??
      header?.menu?.menuRenderer?.topLevelButtons?.[0]?.buttonRenderer?.navigationEndpoint?.watchPlaylistEndpoint?.playlistId
    : browseId.replace(/^VL/, '');

  const shelf = playlistShelf(res);
  const songs: SongItem[] = [];
  for (const c of shelf?.contents ?? []) {
    const r = c.musicResponsiveListItemRenderer;
    const s = r ? songFromListItem(r, { album: albumRef, thumbnail: isAlbum ? thumbnail : undefined, artists: isAlbum ? artists : undefined }) : null;
    if (s) songs.push(s);
  }

  const descRuns =
    header?.description?.musicDescriptionShelfRenderer?.description?.runs ?? header?.description?.runs;

  return {
    id: browseId,
    title: runsText(header?.title),
    author: artists[0],
    description: descRuns ? runsText(descRuns) : undefined,
    year: lastRun && /^\d{4}$/.test(lastRun) ? lastRun : undefined,
    thumbnail,
    playlistId,
    isEditable: !!res?.header?.musicEditablePlaylistDetailHeaderRenderer,
    songs,
    continuation: findContinuation(shelf),
  };
}

export async function playlist(browseId: string): Promise<PlaylistPage> {
  const id = browseId.startsWith('VL') ? browseId : `VL${browseId}`;
  const res = await post('browse', { browseId: id });
  return parsePlaylistLike(res, id, false);
}

export async function album(browseId: string): Promise<PlaylistPage> {
  const res = await post('browse', { browseId });
  return parsePlaylistLike(res, browseId, true);
}

export async function playlistContinuation(continuation: string): Promise<{ songs: SongItem[]; continuation?: string }> {
  const res = await post('browse', {}, { query: { continuation, ctoken: continuation, type: 'next' } });
  const shelf = res?.continuationContents?.musicPlaylistShelfContinuation;
  const rows: Json[] =
    shelf?.contents ??
    res?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems ??
    [];
  const songs: SongItem[] = [];
  for (const c of rows) {
    const s = c.musicResponsiveListItemRenderer ? songFromListItem(c.musicResponsiveListItemRenderer) : null;
    if (s) songs.push(s);
  }
  return { songs, continuation: findContinuation(shelf) ?? findContinuation({ continuationItems: rows }) };
}

/** `Result<PlaylistPage>.completed()` from utils/Utils.kt – follow every continuation. */
export async function playlistComplete(page: PlaylistPage, maxPages = 50): Promise<PlaylistPage> {
  const songs = [...page.songs];
  let token = page.continuation;
  let guard = 0;
  while (token && guard++ < maxPages) {
    const next = await playlistContinuation(token);
    songs.push(...next.songs);
    token = next.continuation;
  }
  return { ...page, songs, continuation: undefined };
}

export async function artist(browseId: string): Promise<ArtistPage> {
  const res = await post('browse', { browseId });
  const header = res?.header?.musicImmersiveHeaderRenderer ?? res?.header?.musicVisualHeaderRenderer;
  const list = singleColumnSectionList(res);
  const play = header?.playButton?.buttonRenderer?.navigationEndpoint?.watchEndpoint;
  const radioEp = header?.startRadioButton?.buttonRenderer?.navigationEndpoint?.watchPlaylistEndpoint;
  return {
    id: browseId,
    name: runsText(header?.title),
    description: header?.description ? runsText(header.description) : undefined,
    subscribersText: header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText
      ? runsText(header.subscriptionButton.subscribeButtonRenderer.subscriberCountText)
      : undefined,
    thumbnail: bestThumbnail(
      header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
        header?.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails,
    ),
    shuffleVideoId: play?.videoId,
    shufflePlaylistId: play?.playlistId,
    radioPlaylistId: radioEp?.playlistId,
    sections: sectionsFromSectionList(list),
  };
}

/* ------------------------------------------------------------------ *
 * Player  (Environment.simplePlayer)
 * ------------------------------------------------------------------ */

export interface StreamFormat {
  itag: number;
  url?: string;
  mimeType: string;
  bitrate: number;
  averageBitrate?: number;
  contentLength?: number;
  audioQuality?: string;
  signatureCipher?: string;
  loudnessDb?: number;
  approxDurationMs?: string;
}

export interface PlayerResult {
  status?: string;
  reason?: string;
  formats: StreamFormat[];
  expiresInSeconds?: number;
  loudnessDb?: number;
  lengthSeconds?: number;
  title?: string;
  author?: string;
}

export async function player(videoId: string, client: 'web' | 'ios' = 'ios', playlistId?: string): Promise<PlayerResult> {
  const res = await post(
    'player',
    {
      videoId,
      playlistId,
      contentCheckOk: true,
      racyCheckOk: true,
      playbackContext: { contentPlaybackContext: {} },
    },
    { client },
  );
  const sd = res?.streamingData;
  const formats: StreamFormat[] = [...(sd?.adaptiveFormats ?? []), ...(sd?.formats ?? [])].map((f: Json) => ({
    itag: f.itag,
    url: f.url,
    mimeType: f.mimeType,
    bitrate: f.bitrate,
    averageBitrate: f.averageBitrate,
    contentLength: f.contentLength ? Number(f.contentLength) : undefined,
    audioQuality: f.audioQuality,
    signatureCipher: f.signatureCipher ?? f.cipher,
    loudnessDb: f.loudnessDb,
    approxDurationMs: f.approxDurationMs,
  }));
  return {
    status: res?.playabilityStatus?.status,
    reason: res?.playabilityStatus?.reason,
    formats,
    expiresInSeconds: sd?.expiresInSeconds ? Number(sd.expiresInSeconds) : undefined,
    loudnessDb: res?.playerConfig?.audioConfig?.loudnessDb,
    lengthSeconds: res?.videoDetails?.lengthSeconds ? Number(res.videoDetails.lengthSeconds) : undefined,
    title: res?.videoDetails?.title,
    author: res?.videoDetails?.author,
  };
}

export { splitBySeparator };
