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

/**
 * Circuit breaker. When the token server does not answer (timeout, connection error, 5xx) twice in a row, it is left alone for a
 * few minutes: songs then start straight away with the on-phone fallback instead of each waiting for a timeout first.
 * A wrong key (401) is a settings problem, answers instantly and does not count.
 */
export const BREAKER_FAILURES = 2;
export const BREAKER_PAUSE_MS = 3 * 60_000;
/** how long one request may take before the server counts as not answering */
export const MINT_TIMEOUT_MS = 8_000;

let consecutiveFailures = 0;
let pausedUntil = 0;

/**
 * Every request to the token server reports how it went (a cache hit is no request and reports nothing): the app keeps these as a
 * record, so that "it sometimes does not connect" can be looked at afterwards (core/netlog.ts).
 */
export type RemoteOutcome = 'ok' | 'timeout' | 'network' | 'http' | 'key' | 'badbody' | 'paused';
export type RemoteObserver = (e: { at: number; what: 'mint' | 'ping'; outcome: RemoteOutcome; ms: number; status?: number }) => void;
let observer: RemoteObserver | undefined;
export function setRemoteObserver(f?: RemoteObserver): void {
  observer = f;
}
function emit(what: 'mint' | 'ping', outcome: RemoteOutcome, startedAt: number, status?: number): void {
  try {
    observer?.({ at: Date.now(), what, outcome, ms: Math.max(0, Date.now() - startedAt), ...(status ? { status } : {}) });
  } catch {
    /* a record must never break playback */
  }
}
const outcomeOfError = (e: unknown): RemoteOutcome => (e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network');

export function resetRemoteBreaker(): void {
  consecutiveFailures = 0;
  pausedUntil = 0;
}

/** seconds until the server is tried again, or 0 when it is not paused */
export function remotePauseSecondsLeft(): number {
  return Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000));
}

function noteFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_FAILURES) pausedUntil = Date.now() + BREAKER_PAUSE_MS;
}

export function configureRemotePot(c?: Partial<RemotePotConfig> | null) {
  const url = (c?.url ?? '').trim().replace(/\/+$/, '');
  cfg = url ? { url, key: c?.key?.trim() || undefined } : undefined;
  cache.clear();
  resetRemoteBreaker();
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
    if (e instanceof Error && e.name === 'AbortError') throw Object.assign(new Error(`token server did not answer within ${timeoutMs / 1000}s`), { name: 'TimeoutError' });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** One token for one content binding (video id, or the visitor data for the session token). Cached until shortly before expiry. */
export async function mintRemote(binding: string, timeoutMs = MINT_TIMEOUT_MS): Promise<string> {
  if (!cfg) throw new Error('token server is not configured');
  const hit = cache.get(binding);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;
  if (Date.now() < pausedUntil) {
    emit('mint', 'paused', Date.now());
    throw new Error(`token server paused after repeated failures (retrying in ${remotePauseSecondsLeft()}s)`);
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await timedFetch(
      `${cfg.url}/get_pot`,
      { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ content_binding: binding }) },
      timeoutMs,
    );
  } catch (e) {
    noteFailure(); // no answer at all: timeout / connection refused / no network
    emit('mint', outcomeOfError(e), started);
    throw e;
  }
  if (res.status === 401) {
    emit('mint', 'key', started, 401);
    throw new Error('token server refused the key (HTTP 401) – check "Token server key"');
  }
  if (!res.ok) {
    if (res.status >= 500) noteFailure();
    emit('mint', 'http', started, res.status);
    throw new Error(`token server HTTP ${res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as { poToken?: string; error?: string };
  if (!body.poToken) {
    noteFailure();
    emit('mint', 'badbody', started, res.status);
    throw new Error(`token server: ${body.error ?? 'no poToken in the answer'}`);
  }
  emit('mint', 'ok', started, res.status);
  resetRemoteBreaker();

  const expiresAt = Date.parse((body as { expiresAt?: string }).expiresAt ?? '') || Date.now() + 6 * 3_600_000;
  cache.set(binding, { token: body.poToken, expiresAt });
  return body.poToken;
}

export async function pingRemote(timeoutMs = 8_000): Promise<string> {
  if (!cfg) throw new Error('token server is not configured');
  const started = Date.now();
  let res: Response;
  try {
    res = await timedFetch(`${cfg.url}/ping`, { headers: headers() }, timeoutMs);
  } catch (e) {
    emit('ping', outcomeOfError(e), started);
    throw e;
  }
  if (res.status === 401) {
    emit('ping', 'key', started, 401);
    throw new Error('refused the key (HTTP 401)');
  }
  if (!res.ok) {
    emit('ping', 'http', started, res.status);
    throw new Error(`HTTP ${res.status}`);
  }
  emit('ping', 'ok', started, res.status);
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
