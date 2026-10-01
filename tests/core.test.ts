import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { configure, defaultConfig } from '../src/core/config';
import * as yt from '../src/core/innertube/api';
import { itemFromListItem, itemFromTwoRow, songFromListItem, songFromPanelVideo } from '../src/core/innertube/parsers';
import { base64ToUtf8 } from '../src/core/lyrics/base64';
import { keyword } from '../src/core/lyrics/kugou';
import { activeLineIndex, normalizeKuGou, parseLrc } from '../src/core/lyrics/lrc';
import { pickAudio } from '../src/core/streams/piped';
import { clearStreamCache, resolveAudio } from '../src/core/streams/resolver';

/* ---------- fixtures (shapes follow real YouTube Music responses) ---------- */

const artistRun = { text: 'Daft Punk', navigationEndpoint: { browseEndpoint: { browseId: 'UC_artist', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } } };
const albumRun = { text: 'Discovery', navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_album', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' } } } } };
const sep = { text: ' • ' };
const thumbs = (n: number) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'small', width: 60, height: 60 }, { url: `big${n}`, width: 544, height: 544 }] } } });

const songRow = {
  playlistItemData: { videoId: 'vid123' },
  thumbnail: thumbs(1),
  badges: [{ musicInlineBadgeRenderer: { icon: { iconType: 'MUSIC_EXPLICIT_BADGE' } } }],
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'One More Time', navigationEndpoint: { watchEndpoint: { videoId: 'vid123', watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' } } } } }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [artistRun, sep, albumRun, sep, { text: '5:20' }] } } },
  ],
};

const albumRow = {
  navigationEndpoint: albumRun.navigationEndpoint,
  thumbnail: thumbs(2),
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Discovery' }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Album' }, sep, artistRun, sep, { text: '2001' }] } } },
  ],
  overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'OLAK5uy_x' } } } } } },
};

const artistRow = {
  navigationEndpoint: artistRun.navigationEndpoint,
  thumbnail: thumbs(3),
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Daft Punk' }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artist' }, sep, { text: '9.8M subscribers' }] } } },
  ],
};

const playlistRow = {
  navigationEndpoint: { browseEndpoint: { browseId: 'VLPL123', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_PLAYLIST' } } } },
  thumbnail: thumbs(4),
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Chill mix' }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Playlist' }, sep, { text: 'YouTube Music' }, sep, { text: '25 songs' }] } } },
  ],
};

/* ---------- fetch mock ---------- */

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];
function mockFetch(h: Handler) {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return h(url, init);
  }) as typeof fetch;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  configure({ ...defaultConfig });
  clearStreamCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/* ---------- lyrics ---------- */

describe('lrc', () => {
  it('parses timestamps (incl. multiple per line, mm:ss without fraction)', () => {
    const lines = parseLrc('[00:01.50]Hello\n[00:05]World\n[00:10.00][00:20.00]Chorus\nnot a lyric line');
    assert.deepEqual(lines.map((l) => [l.time, l.text]), [[0, ''], [1500, 'Hello'], [5000, 'World'], [10000, 'Chorus'], [20000, 'Chorus']]);
  });
  it('finds active line', () => {
    const lines = parseLrc('[00:01.00]a\n[00:05.00]b\n[00:09.00]c');
    assert.equal(lines[activeLineIndex(lines, 0)].text, '');
    assert.equal(lines[activeLineIndex(lines, 5000)].text, 'b');
    assert.equal(lines[activeLineIndex(lines, 99999)].text, 'c');
  });
  it('normalizes KuGou headers', () => {
    const raw = '[id:$00000000]\n[ar:Daft Punk]\n[ti:One More Time]\n[by:]\n[00:00.00]Daft Punk - One More Time\n[00:01.00]Real line &apos;x&apos;';
    const out = normalizeKuGou(raw);
    assert.ok(out.includes("Real line 'x'"));
    assert.ok(!out.includes('[ar:'));
  });
  it('builds KuGou keyword with featuring', () => {
    assert.equal(keyword('A & B', 'Song (feat. C)'), 'A、B、C - Song');
  });
  it('decodes base64 UTF-8 (CJK)', () => {
    const b64 = Buffer.from('[00:01.00]你好 ♪ world', 'utf8').toString('base64');
    assert.equal(base64ToUtf8(b64), '[00:01.00]你好 ♪ world');
  });
});

/* ---------- parsers ---------- */

describe('parsers', () => {
  it('parses a song row', () => {
    const s = songFromListItem(songRow)!;
    assert.equal(s.id, 'vid123');
    assert.equal(s.title, 'One More Time');
    assert.deepEqual(s.artists, [{ id: 'UC_artist', name: 'Daft Punk' }]);
    assert.deepEqual(s.album, { id: 'MPREb_album', name: 'Discovery' });
    assert.equal(s.durationText, '5:20');
    assert.equal(s.durationSec, 320);
    assert.equal(s.thumbnail, 'big1'); // best quality, not first
    assert.equal(s.explicit, true);
  });
  it('classifies list rows', () => {
    assert.equal(itemFromListItem(songRow)?.kind, 'song');
    const album = itemFromListItem(albumRow);
    assert.equal(album?.kind, 'album');
    assert.equal(album?.kind === 'album' && album.year, '2001');
    assert.equal(album?.kind === 'album' && album.playlistId, 'OLAK5uy_x');
    const artist = itemFromListItem(artistRow);
    assert.equal(artist?.kind === 'artist' && artist.subscribersText, '9.8M subscribers');
    const pl = itemFromListItem(playlistRow);
    assert.equal(pl?.kind === 'playlist' && pl.songCount, 25);
  });
  it('treats OMV as video', () => {
    const omv = structuredClone(songRow);
    omv.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].navigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType = 'MUSIC_VIDEO_TYPE_OMV';
    const v = itemFromListItem(omv);
    assert.equal(v?.kind, 'video');
    assert.equal(v?.kind === 'video' && v.isOfficialMusicVideo, true);
  });
  it('parses two-row cards', () => {
    const card = { title: { runs: [{ text: 'Discovery' }] }, navigationEndpoint: albumRun.navigationEndpoint, subtitle: { runs: [{ text: 'Album' }, sep, artistRun, sep, { text: '2001' }] }, thumbnailRenderer: thumbs(5) };
    const a = itemFromTwoRow(card);
    assert.equal(a?.kind, 'album');
    assert.equal(a?.kind === 'album' && a.year, '2001');
  });
  it('parses queue entries', () => {
    const r = { navigationEndpoint: { watchEndpoint: { videoId: 'q1' } }, title: { runs: [{ text: 'Aerodynamic' }] }, longBylineText: { runs: [artistRun, sep, albumRun, sep, { text: '2001' }] }, lengthText: { runs: [{ text: '3:27' }] }, thumbnail: { thumbnails: [{ url: 'a', width: 10, height: 10 }] } };
    const s = songFromPanelVideo(r)!;
    assert.equal(s.id, 'q1');
    assert.equal(s.album?.name, 'Discovery');
    assert.equal(s.durationSec, 207);
  });
});

/* ---------- api with mocked network ---------- */

describe('api', () => {
  it('search posts the right request and parses mixed results', async () => {
    mockFetch(() => json({ contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
      { musicShelfRenderer: { contents: [{ musicResponsiveListItemRenderer: songRow }, { musicResponsiveListItemRenderer: albumRow }], continuations: [{ nextContinuationData: { continuation: 'TOKEN' } }] } },
      { musicShelfRenderer: { contents: [{ musicResponsiveListItemRenderer: artistRow }, { musicResponsiveListItemRenderer: songRow }] } },
    ] } } } }] } } }));

    const page = await yt.search('daft punk');
    assert.deepEqual(page.items.map((i) => i.kind), ['song', 'album', 'artist']); // duplicate song removed
    assert.equal(page.continuation, 'TOKEN');

    const { url, init } = calls[0];
    assert.match(url, /^https:\/\/music\.youtube\.com\/youtubei\/v1\/search\?prettyPrint=false$/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.query, 'daft punk');
    assert.equal(body.context.client.clientName, 'WEB_REMIX');
    assert.equal((init?.headers as Record<string, string>)['X-YouTube-Client-Name'], '67');
  });

  it('filtered search keeps the percent-encoded params untouched', async () => {
    mockFetch(() => json({}));
    await yt.search('x', 'song');
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.params, 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D');
  });

  it('parses an album page (songs inherit album art + artist)', async () => {
    const albumSongRow = {
      playlistItemData: { videoId: 'a1' },
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Track 1' }] } } }, { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [] } } }],
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '4:01' }] } } }],
    };
    mockFetch(() => json({
      microformat: { microformatDataRenderer: { urlCanonical: 'https://music.youtube.com/playlist?list=OLAK5uy_abc' } },
      contents: { twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: { title: { runs: [{ text: 'Discovery' }] }, subtitle: { runs: [{ text: 'Album' }, sep, { text: '2001' }] }, straplineTextOne: { runs: [artistRun] }, thumbnail: thumbs(9) } }] } } } }],
        secondaryContents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [{ musicResponsiveListItemRenderer: albumSongRow }] } }] } },
      } },
    }));
    const a = await yt.album('MPREb_album');
    assert.equal(a.title, 'Discovery');
    assert.equal(a.year, '2001');
    assert.equal(a.playlistId, 'OLAK5uy_abc');
    assert.equal(a.songs.length, 1);
    assert.equal(a.songs[0].artists[0].name, 'Daft Punk');
    assert.equal(a.songs[0].album?.name, 'Discovery');
    assert.equal(a.songs[0].thumbnail, 'big9');
    assert.equal(a.songs[0].durationSec, 241);
  });

  it('follows playlist continuations', async () => {
    const row = (id: string) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId: id }, flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: id }] } } }] } });
    let n = 0;
    mockFetch(() => {
      n++;
      if (n === 1) return json({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: { title: { runs: [{ text: 'PL' }] } } }] } } } }], secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: [row('s1'), row('s2')], continuations: [{ nextContinuationData: { continuation: 'C1' } }] } }] } } } } });
      return json({ continuationContents: { musicPlaylistShelfContinuation: { contents: [row('s3')] } } });
    });
    const page = await yt.playlist('PL123');
    assert.equal(calls[0].init && JSON.parse(String(calls[0].init.body)).browseId, 'VLPL123');
    const full = await yt.playlistComplete(page);
    assert.deepEqual(full.songs.map((s) => s.id), ['s1', 's2', 's3']);
    assert.match(calls[1].url, /continuation=C1&ctoken=C1&type=next/);
  });

  it('next() follows the automix preview when no playlistId is given', async () => {
    const panel = (contents: unknown[]) => json({ contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { watchNextTabbedResultsRenderer: { tabs: [{ tabRenderer: { content: { musicQueueRenderer: { content: { playlistPanelRenderer: { contents } } } } } }] } } } } });
    let n = 0;
    mockFetch(() => {
      n++;
      return n === 1
        ? panel([{ automixPreviewVideoRenderer: { content: { automixPlaylistVideoRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDAMVMx', params: 'P' } } } } } }])
        : panel([{ playlistPanelVideoRenderer: { navigationEndpoint: { watchEndpoint: { videoId: 'r1' } }, title: { runs: [{ text: 'Radio song' }] }, longBylineText: { runs: [artistRun] } } }]);
    });
    const page = await yt.next({ videoId: 'x' });
    assert.equal(page.songs[0].id, 'r1');
    assert.equal(JSON.parse(String(calls[1].init?.body)).playlistId, 'RDAMVMx');
  });

  it('search suggestions', async () => {
    mockFetch(() => json({ contents: [{ searchSuggestionsSectionRenderer: { contents: [{ searchSuggestionRenderer: { suggestion: { runs: [{ text: 'daft ' }, { text: 'punk' }] } } }] } }] }));
    const s = await yt.searchSuggestions('daft');
    assert.deepEqual(s.queries, ['daft punk']);
  });
});

/* ---------- streams ---------- */

describe('streams', () => {
  it('prefers AAC/m4a (iOS cannot play webm/opus)', () => {
    const src = pickAudio([
      { itag: 251, url: 'u251', bitrate: 160000, mimeType: 'audio/webm' },
      { itag: 140, url: 'u140?expire=2000000000', bitrate: 128000, mimeType: 'audio/mp4' },
      { itag: 18, url: 'uV', bitrate: 999999, mimeType: 'video/mp4', videoOnly: true },
    ])!;
    assert.equal(src.itag, 140);
    assert.equal(src.expiresAt, 2000000000 * 1000);
  });

  it('resolver falls through innertube -> piped and caches', async () => {
    mockFetch((url) => {
      if (url.includes('/youtubei/v1/player')) return json({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in' } });
      if (url.startsWith('https://pipedapi.nosebs.ru')) return json({ audioStreams: [{ itag: 140, url: 'https://cdn/x?expire=4102444800', bitrate: 128000, mimeType: 'audio/mp4' }] });
      return json({}, 500);
    });
    const a = await resolveAudio('abc');
    assert.equal(a.via, 'piped');
    const before = calls.length;
    const b = await resolveAudio('abc');
    assert.equal(b.url, a.url);
    assert.equal(calls.length, before); // cache hit
  });

  it('resolver reports every backend failure', async () => {
    mockFetch(() => json({}, 500));
    await assert.rejects(() => resolveAudio('zzz', { pipedInstances: ['https://p.example'], invidiousInstances: ['https://i.example'] }), /innertube[\s\S]*piped[\s\S]*invidious/);
  });
});
