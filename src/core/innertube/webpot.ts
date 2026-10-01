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

export async function resolveWithPoToken(videoId: string, opts: { validate?: boolean } = {}): Promise<AudioSource> {
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

  let url = await getStreamUrl(format, player);
  url += `${url.includes('?') ? '&' : '?'}pot=${pot.streaming}`;

  const ua = getConfig().web.userAgent;
  if (opts.validate !== false) {
    // Cheap check so errors are explained here instead of as a silent player failure
    const probe = await fetch(url, { headers: { Range: 'bytes=0-1', ...(ua ? { 'User-Agent': ua } : {}) } });
    if (!probe.ok && probe.status !== 206) throw new Error(`Stream URL rejected by YouTube (HTTP ${probe.status})`);
  }

  const expiresIn = sd?.expiresInSeconds ? Number(sd.expiresInSeconds) : 3600;
  return {
    url,
    mimeType: 'audio/mp4',
    bitrate: format.bitrate,
    itag: format.itag,
    contentLength: format.contentLength ? Number(format.contentLength) : undefined,
    via: 'webpot',
    userAgent: ua,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}
