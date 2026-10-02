import { configure, getConfig } from '../config';
import { poTokenProvider } from '../pot/potoken';
import { getPlayerJs, getStreamUrl } from '../pot/solver';
import type { AudioSource } from '../types';
import { post } from './client';
import type { Json } from './helpers';

/**
 * Port of `SimplePlayer.playerResponseForPlaybackWithWebPotoken` (RiMusic):
 * WEB_REMIX `player` request with signatureTimestamp + PO token, stream url deciphered,
 * `&pot=<streaming token>` appended. Works without a login (session id = visitorData).
 */

export async function ensureVisitorData(): Promise<string> {
  const have = getConfig().visitorData;
  if (have) return have;
  const res = await post<Json>('music/get_search_suggestions', { input: '' });
  let vd: string | undefined = res?.responseContext?.visitorData;
  if (!vd) {
    const home = await post<Json>('browse', { browseId: 'FEmusic_home' });
    vd = home?.responseContext?.visitorData;
  }
  if (!vd) throw new Error('YouTube did not return visitorData');
  configure({ visitorData: vd });
  return vd;
}

function randomCpn(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

interface WebFormat {
  itag: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  mimeType: string;
  bitrate: number;
  contentLength?: string;
}

/** AVPlayer can play AAC in MP4 (itag 140 / 141) but not WebM/Opus. */
export function pickM4aFormat(formats: WebFormat[]): WebFormat | undefined {
  return formats
    .filter((f) => f.mimeType?.startsWith('audio/mp4'))
    .sort((a, b) => b.bitrate - a.bitrate)[0];
}

export type PotMode = 'streaming' | 'player' | 'none';

/**
 * Is this URL really playable? Checks a tiny range at the start AND one in the middle of the file.
 * With an unacceptable PO token googlevideo serves the first bytes and then answers 403 – a check of
 * bytes 0-1 alone does not notice that.
 */
async function probeStatus(url: string, size: number, userAgent?: string): Promise<number> {
  const mid = Math.max(1, Math.floor(size / 2));
  for (const range of ['bytes=0-1', `bytes=${mid}-${mid + 1}`]) {
    const res = await fetch(url, { headers: { Range: range, ...(userAgent ? { 'User-Agent': userAgent } : {}) } });
    if (res.status !== 206 && res.status !== 200) return res.status;
  }
  return 206;
}

export async function resolveWithPoToken(
  videoId: string,
  opts: { validate?: boolean; potMode?: PotMode } = {},
): Promise<AudioSource> {
  const visitorData = await ensureVisitorData();
  const player = await getPlayerJs();
  const pot = await poTokenProvider.getWebClientPoToken(videoId, visitorData);

  const res = await post<Json>(
    'player',
    {
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      cpn: randomCpn(),
      playbackContext: {
        contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS', signatureTimestamp: player.sts },
      },
      serviceIntegrityDimensions: { poToken: pot.player },
    },
    { client: 'web' },
  );

  const status: string | undefined = res?.playabilityStatus?.status;
  if (status !== 'OK') {
    throw new Error(`YouTube: ${status ?? 'no playabilityStatus'}${res?.playabilityStatus?.reason ? ` – ${res.playabilityStatus.reason}` : ''}`);
  }
  const sd = res?.streamingData;
  const format = pickM4aFormat([...(sd?.adaptiveFormats ?? []), ...(sd?.formats ?? [])]);
  if (!format) throw new Error('No AAC (audio/mp4) format offered for this video');

  const baseUrl = await getStreamUrl(format, player);
  const joiner = baseUrl.includes('?') ? '&' : '?';

  // Which token goes into the stream url's `pot=`?
  //  - default (auto): YouTube is moving videos from session-bound to video-bound tokens (FreeTube #8137,
  //    yt-dlp PO Token Guide) and the choice differs per video, so try the video-bound one first, then the
  //    session-bound one, and keep whichever googlevideo really accepts.
  //  - 'player' / 'streaming' / 'none' force one variant (used by Settings → Diagnostics experiments).
  type Candidate = { kind: string; url: string };
  const video: Candidate = { kind: 'video-bound', url: `${baseUrl}${joiner}pot=${pot.player}` };
  const session: Candidate = { kind: 'session-bound', url: `${baseUrl}${joiner}pot=${pot.streaming}` };
  const candidates: Candidate[] =
    opts.potMode === 'none'
      ? [{ kind: 'no pot', url: baseUrl }]
      : opts.potMode === 'player'
        ? [video]
        : opts.potMode === 'streaming'
          ? [session]
          : [video, session];

  const ua = getConfig().web.userAgent;
  const size = format.contentLength ? Number(format.contentLength) : 2_000_000;
  let { url, kind } = candidates[0];
  if (opts.validate !== false) {
    const failures: string[] = [];
    let accepted = false;
    for (const c of candidates) {
      const status = await probeStatus(c.url, size, ua);
      if (status === 206) {
        ({ url, kind } = c);
        accepted = true;
        break;
      }
      failures.push(`${c.kind}: HTTP ${status}`);
    }
    if (!accepted) throw new Error(`Stream URL rejected by YouTube (${failures.join(', ')})`);
  }

  const expiresIn = sd?.expiresInSeconds ? Number(sd.expiresInSeconds) : 3600;
  return {
    url,
    mimeType: 'audio/mp4',
    bitrate: format.bitrate,
    itag: format.itag,
    contentLength: format.contentLength ? Number(format.contentLength) : undefined,
    via: 'webpot',
    note: `pot=${kind}`,
    userAgent: ua,
    potTokens: pot,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}
