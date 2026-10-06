import { chooseByQuality } from '../streams/quality';
import { configure, getConfig } from '../config';
import { poTokenProvider } from '../pot/potoken';
import { getRemotePoTokens, isRemotePotConfigured } from '../pot/remote';
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
  loudnessDb?: number;
}

/**
 * AAC in MP4 (itag 140 / 141) plays everywhere, so it is always preferred.
 * AVPlayer (iOS) cannot play WebM/Opus; Android's player can – so there it is the fallback when no AAC is offered.
 */
export function pickAudioFormat(formats: WebFormat[]): WebFormat | undefined {
  const { quality, platform } = getConfig();
  return chooseByQuality(formats.filter((f) => f.mimeType?.startsWith('audio/')), quality, platform);
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
    const res = await fetch(url, { credentials: 'omit', headers: { Range: range, ...(userAgent ? { 'User-Agent': userAgent } : {}) } });
    if (res.status !== 206 && res.status !== 200) return res.status;
  }
  return 206;
}

export interface WebFormat2 extends WebFormat {
  approxDurationMs?: string;
}

export interface WebPlayerData {
  player: Awaited<ReturnType<typeof getPlayerJs>>;
  pot: { player: string; streaming: string; streamingDecoded?: string; streamingVisitorId?: string; source?: 'local' | 'remote' };
  /** why the token server was skipped, if it was configured but failed */
  remoteError?: string;
  formats: WebFormat2[];
  expiresInSeconds: number;
  /** video-level loudness (dB above YouTube's reference), when the response has it */
  loudnessDb?: number;
}

/** Steps 1-3 of the flow: visitorData, player JS, PO tokens, then the `player` request. */
export async function fetchWebFormats(videoId: string): Promise<WebPlayerData> {
  const visitorData = await ensureVisitorData();
  const player = await getPlayerJs();
  // Tokens from the configured token server (a bgutil server outside the phone) if there is one,
  // otherwise – or if the server cannot be reached – from BotGuard running in this phone's WebView.
  let pot: WebPlayerData['pot'] | undefined;
  let remoteError: string | undefined;
  if (isRemotePotConfigured()) {
    try {
      pot = await getRemotePoTokens(videoId, visitorData);
    } catch (e) {
      remoteError = e instanceof Error ? e.message : String(e);
    }
  }
  pot ??= await poTokenProvider.getWebClientPoToken(videoId, visitorData);

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
  return {
    player,
    pot,
    remoteError,
    formats: [...(sd?.adaptiveFormats ?? []), ...(sd?.formats ?? [])],
    expiresInSeconds: sd?.expiresInSeconds ? Number(sd.expiresInSeconds) : 3600,
    loudnessDb: typeof res?.playerConfig?.audioConfig?.loudnessDb === 'number' ? res.playerConfig.audioConfig.loudnessDb : undefined,
  };
}

/** Muxed (video+audio) MP4 with AAC – itag 18. Some clients do not enforce PO tokens for it. */
export function pickMuxedFormat(formats: WebFormat[]): WebFormat | undefined {
  return formats
    .filter((f) => f.mimeType?.startsWith('video/mp4') && /mp4a/.test(f.mimeType))
    .sort((a, b) => a.bitrate - b.bitrate)[0];
}

type PotKind = 'video-bound' | 'session-bound' | 'session-decoded' | 'visitor-id' | 'no pot';

function tokenFor(kind: PotKind, pot: WebPlayerData['pot']): string | undefined {
  switch (kind) {
    case 'video-bound':
      return pot.player;
    case 'session-bound':
      return pot.streaming;
    case 'session-decoded':
      return pot.streamingDecoded;
    case 'visitor-id':
      return pot.streamingVisitorId;
    default:
      return undefined;
  }
}

/** Token kinds worth trying, in order (variants that do not exist for this session are dropped). */
const AUTO_KINDS: PotKind[] = ['video-bound', 'session-bound', 'session-decoded', 'visitor-id'];
interface Candidate {
  kind: PotKind;
  url: string;
}

/** Build the candidate stream urls for one format and keep the first one googlevideo really serves. */
async function tryFormat(
  format: WebFormat,
  wp: WebPlayerData,
  kinds: PotKind[],
  validate: boolean,
): Promise<{ url: string; kind: PotKind }> {
  const baseUrl = await getStreamUrl(format, wp.player);
  const joiner = baseUrl.includes('?') ? '&' : '?';
  const candidates: Candidate[] = kinds
    .filter((kind) => kind === 'no pot' || tokenFor(kind, wp.pot))
    .map((kind) => ({
      kind,
      url: kind === 'no pot' ? baseUrl : `${baseUrl}${joiner}pot=${tokenFor(kind, wp.pot)}`,
    }));
  if (!validate) return candidates[0];

  const ua = getConfig().web.userAgent;
  const size = format.contentLength ? Number(format.contentLength) : 2_000_000;
  // all candidates are asked at the same time; the first (by priority) that googlevideo serves wins
  const statuses = await Promise.all(candidates.map((c) => probeStatus(c.url, size, ua).catch(() => 0)));
  const winner = statuses.findIndex((st) => st === 206);
  if (winner >= 0) return candidates[winner];
  throw new Error(`Stream URL rejected by YouTube (${candidates.map((c, i) => `${c.kind}: HTTP ${statuses[i]}`).join(', ')})`);
}

export async function resolveWithPoToken(
  videoId: string,
  opts: { validate?: boolean; potMode?: PotMode } = {},
): Promise<AudioSource> {
  const wp = await fetchWebFormats(videoId);
  const validate = opts.validate !== false;
  const ua = getConfig().web.userAgent;
  const toSource = (format: WebFormat, url: string, kind: PotKind, mime: string): AudioSource => ({
    url,
    mimeType: mime,
    bitrate: format.bitrate,
    itag: format.itag,
    contentLength: format.contentLength ? Number(format.contentLength) : undefined,
    loudnessDb: typeof format.loudnessDb === 'number' ? format.loudnessDb : wp.loudnessDb,
    via: 'webpot',
    note: `itag${format.itag} pot=${kind}${wp.pot.source === 'remote' ? ' (token server)' : wp.remoteError ? ' (token server failed: ' + wp.remoteError + ')' : ''}`,
    userAgent: ua,
    potTokens: wp.pot,
    expiresAt: Date.now() + wp.expiresInSeconds * 1000,
  });

  // Which token goes into the stream url's `pot=`?
  //  - default (auto): video-bound first, then session-bound (YouTube is moving videos between the two – FreeTube #8137,
  //    yt-dlp PO Token Guide); keep whichever googlevideo really accepts.
  //  - 'player' / 'streaming' / 'none' force one variant (Settings → Diagnostics experiments).
  const forced: PotKind[] | undefined =
    opts.potMode === 'none' ? ['no pot'] : opts.potMode === 'player' ? ['video-bound'] : opts.potMode === 'streaming' ? ['session-bound'] : undefined;
  const failures: string[] = [];

  const audio = pickAudioFormat(wp.formats);
  if (!audio) failures.push('No playable audio format offered for this video');
  else {
    try {
      const r = await tryFormat(audio, wp, forced ?? AUTO_KINDS, validate);
      return toSource(audio, r.url, r.kind, audio.mimeType.split(';')[0]);
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Fallback: the muxed 360p MP4 (itag 18). AVPlayer plays its AAC track; some clients do not need a PO token for it.
  const muxed = forced ? undefined : pickMuxedFormat(wp.formats);
  if (muxed) {
    try {
      const r = await tryFormat(muxed, wp, ['no pot', ...AUTO_KINDS], validate);
      return toSource(muxed, r.url, r.kind, 'video/mp4');
    } catch (e) {
      failures.push(`itag ${muxed.itag}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(failures.join(' | '));
}

/**
 * For Settings → Diagnostics: every audio / muxed format with every way of attaching a token,
 * tested with a request from the middle of the file.
 */
export async function formatMatrix(videoId: string): Promise<{ label: string; results: string }[]> {
  const wp = await fetchWebFormats(videoId);
  const ua = getConfig().web.userAgent;
  const rows: { label: string; results: string }[] = [];
  const interesting = wp.formats.filter((f) => f.mimeType?.startsWith('audio/') || (f.mimeType?.startsWith('video/mp4') && /mp4a/.test(f.mimeType)));
  for (const f of interesting) {
    const label = `itag ${f.itag} ${f.mimeType.split(';')[0]} ${Math.round(f.bitrate / 1000)}k${f.signatureCipher || f.cipher ? ' (cipher)' : ''}`;
    try {
      const base = await getStreamUrl(f, wp.player);
      const j = base.includes('?') ? '&' : '?';
      const size = f.contentLength ? Number(f.contentLength) : 2_000_000;
      const variants: [string, string][] = [
        ['none', base],
        ['video', `${base}${j}pot=${wp.pot.player}`],
        ['session', `${base}${j}pot=${wp.pot.streaming}`],
        ...(wp.pot.streamingDecoded ? ([['session-dec', `${base}${j}pot=${wp.pot.streamingDecoded}`]] as [string, string][]) : []),
        ...(wp.pot.streamingVisitorId ? ([['visitor-id', `${base}${j}pot=${wp.pot.streamingVisitorId}`]] as [string, string][]) : []),
      ];
      const out: string[] = [];
      const statuses = await Promise.all(variants.map(([, url]) => probeStatus(url, size, ua).catch(() => 0)));
      variants.forEach(([name], i) => out.push(`${name} ${statuses[i]}`));
      rows.push({ label, results: out.join(' | ') });
    } catch (e) {
      rows.push({ label, results: e instanceof Error ? e.message : String(e) });
    }
  }
  return rows;
}
