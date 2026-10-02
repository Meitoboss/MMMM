import { decodeVisitorData, extractVisitorId } from './botguard';
import type { PoTokenResult } from './potoken';

/**
 * Client for a bgutil-ytdlp-pot-provider server (https://github.com/Brainicism/bgutil-ytdlp-pot-provider).
 * The server runs BotGuard outside a phone and mints PO tokens on request:
 *   POST {url}/get_pot   { "content_binding": "<video id | visitor data>" }  ->  { poToken, expiresAt }
 * Everything else (player request, signature solving, streaming) still happens on the phone.
 */
export interface RemotePotConfig {
  url: string;
  /** sent as `X-Api-Key` (checked by the reverse proxy in front of the server) */
  key?: string;
}

let cfg: RemotePotConfig | undefined;
const cache = new Map<string, { token: string; expiresAt: number }>();

export function configureRemotePot(c?: Partial<RemotePotConfig> | null) {
  const url = (c?.url ?? '').trim().replace(/\/+$/, '');
  cfg = url ? { url, key: c?.key?.trim() || undefined } : undefined;
  cache.clear();
}

export const isRemotePotConfigured = (): boolean => !!cfg;
export const getRemotePotConfig = (): RemotePotConfig | undefined => cfg;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(cfg?.key ? { 'X-Api-Key': cfg.key } : {}), ...extra };
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, credentials: 'omit', signal: ctl.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`token server did not answer within ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** One token for one content binding (video id, or the visitor data for the session token). Cached until shortly before expiry. */
export async function mintRemote(binding: string, timeoutMs = 20_000): Promise<string> {
  if (!cfg) throw new Error('token server is not configured');
  const hit = cache.get(binding);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;

  const res = await timedFetch(
    `${cfg.url}/get_pot`,
    { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ content_binding: binding }) },
    timeoutMs,
  );
  if (res.status === 401) throw new Error('token server refused the key (HTTP 401) – check "Token server key"');
  if (!res.ok) throw new Error(`token server HTTP ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { poToken?: string; error?: string };
  if (!body.poToken) throw new Error(`token server: ${body.error ?? 'no poToken in the answer'}`);

  const expiresAt = Date.parse((body as { expiresAt?: string }).expiresAt ?? '') || Date.now() + 6 * 3_600_000;
  cache.set(binding, { token: body.poToken, expiresAt });
  return body.poToken;
}

export async function pingRemote(timeoutMs = 8_000): Promise<string> {
  if (!cfg) throw new Error('token server is not configured');
  const res = await timedFetch(`${cfg.url}/ping`, { headers: headers() }, timeoutMs);
  if (res.status === 401) throw new Error('refused the key (HTTP 401)');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Same shape as the on-phone provider returns, so the rest of the code does not care where tokens came from. */
export async function getRemotePoTokens(videoId: string, sessionId: string): Promise<PoTokenResult> {
  const decoded = decodeVisitorData(sessionId);
  const visitorId = extractVisitorId(sessionId);
  const [player, streaming, streamingDecoded, streamingVisitorId] = await Promise.all([
    mintRemote(videoId),
    mintRemote(sessionId),
    decoded !== sessionId ? mintRemote(decoded) : Promise.resolve(undefined),
    visitorId && visitorId !== sessionId && visitorId !== decoded ? mintRemote(visitorId) : Promise.resolve(undefined),
  ]);
  return { player, streaming, streamingDecoded, streamingVisitorId, source: 'remote' };
}
