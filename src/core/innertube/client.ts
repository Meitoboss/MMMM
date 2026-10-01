import { ClientProfile, InnerTubeConfig, getConfig } from '../config';
import type { Json } from './helpers';

export class InnerTubeError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: string,
  ) {
    super(message);
    this.name = 'InnerTubeError';
  }
}

export type ClientKind = 'web' | 'ios';

export interface PostOptions {
  client?: ClientKind;
  /** extra query-string parameters (e.g. continuation / ctoken / type) */
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Do not wrap the body with `context` (used by endpoints that need none) */
  rawBody?: boolean;
}

/** `Client.toContext(locale, visitorData)` from Context.kt */
export function buildContext(cfg: InnerTubeConfig, profile: ClientProfile): Json {
  return {
    client: {
      clientName: profile.clientName,
      clientVersion: profile.clientVersion,
      hl: cfg.hl,
      gl: cfg.gl,
      visitorData: cfg.visitorData,
      osName: profile.osName,
      osVersion: profile.osVersion,
      deviceMake: profile.deviceMake,
      deviceModel: profile.deviceModel,
    },
    user: { lockedSafetyMode: false },
    request: { useSsl: true, internalExperimentFlags: [] },
  };
}

function buildHeaders(cfg: InnerTubeConfig, profile: ClientProfile, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Goog-Api-Format-Version': '1',
    'X-YouTube-Client-Name': String(profile.xClientName),
    'X-YouTube-Client-Version': profile.clientVersion,
    'X-Origin': cfg.origin,
    Origin: cfg.origin,
    Referer: `${cfg.origin}/`,
  };
  if (profile.userAgent) headers['User-Agent'] = profile.userAgent;
  if (cfg.visitorData) headers['X-Goog-Visitor-Id'] = cfg.visitorData;
  if (cfg.cookie) headers.Cookie = cfg.cookie;
  return { ...headers, ...extra };
}

function qs(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    // values such as search filter params are already percent-encoded – keep them as is
    parts.push(`${k}=${/%[0-9A-Fa-f]{2}/.test(v) ? v : encodeURIComponent(v)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * POST https://{host}{apiPath}/{path}
 * Equivalent of `client.post(_xxx) { setLogin(...); setBody(...) }` in Environment.kt
 */
export async function post<T = Json>(path: string, body: Json, opts: PostOptions = {}): Promise<T> {
  const cfg = getConfig();
  const profile = cfg[opts.client ?? 'web'];
  const url = `https://${cfg.host}${cfg.apiPath}/${path}${qs({ prettyPrint: 'false', ...opts.query })}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  opts.signal?.addEventListener('abort', () => controller.abort());

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(cfg, profile, opts.headers),
      body: JSON.stringify(opts.rawBody ? body : { context: buildContext(cfg, profile), ...body }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InnerTubeError(`InnerTube ${path} failed: HTTP ${res.status}`, res.status, text);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
