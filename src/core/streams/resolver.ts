import { player } from '../innertube/api';
import { resolveWithPoToken } from '../innertube/webpot';
import type { AudioSource } from '../types';
import * as invidious from './invidious';
import * as piped from './piped';
import * as server from './server';
import { getConfig } from '../config';
import { expiryFromUrl } from './util';
import { chooseByQuality } from './quality';

export type StreamBackend = 'server' | 'webpot' | 'innertube' | 'piped' | 'invidious';

export interface ResolverOptions {
  order?: StreamBackend[];
  pipedInstances?: string[];
  invidiousInstances?: string[];
  /** URL of your own server/server.mjs, e.g. http://192.168.1.10:8787 – used first when set */
  serverUrl?: string;
  serverKey?: string;
}

const cache = new Map<string, AudioSource>();

/** where the stream addresses are kept between starts (set by the app; the core stays free of storage) */
export interface StreamStore {
  load(): Record<string, AudioSource>;
  save(entries: Record<string, AudioSource>): void;
}
let store: StreamStore | null = null;
let loaded = false;
/** how many addresses are kept between starts */
const KEEP = 60;

export function setStreamStore(s: StreamStore): void {
  store = s;
  loaded = false;
}

function loadOnce(): void {
  if (loaded || !store) return;
  loaded = true;
  for (const [id, src] of Object.entries(store.load())) {
    if (!src.expiresAt || src.expiresAt - 60_000 > Date.now()) cache.set(id, src);
  }
}

function persist(): void {
  if (!store) return;
  const kept = [...cache.entries()].slice(-KEEP);
  store.save(Object.fromEntries(kept));
}

/** InnerTube `player` (iOS client): direct, non-ciphered URLs – no signature deciphering needed. */
async function viaInnerTube(videoId: string): Promise<AudioSource> {
  const r = await player(videoId, 'ios');
  if (r.status && r.status !== 'OK') throw new Error(`InnerTube: ${r.status} ${r.reason ?? ''}`.trim());
  const { quality, platform } = getConfig();
  const best = chooseByQuality(
    r.formats.filter((f) => f.url && f.mimeType.startsWith('audio/')).map((f) => ({ ...f, mimeType: f.mimeType.split(';')[0] })),
    quality,
    platform,
  );
  if (!best?.url) throw new Error('InnerTube: no directly playable audio format (ciphered or PO-token protected)');
  return {
    url: best.url,
    mimeType: best.mimeType.split(';')[0],
    bitrate: best.bitrate,
    itag: best.itag,
    contentLength: best.contentLength,
    via: 'innertube',
    expiresAt: expiryFromUrl(best.url) ?? (r.expiresInSeconds ? Date.now() + r.expiresInSeconds * 1000 : undefined),
  };
}

/** the first backend starts at once; each next one joins after this long without an answer (or at once when it fails) */
const HEDGE_MS = 1200;

/**
 * The first backend that answers wins. A slow backend does not hold up the others: the next one starts after HEDGE_MS.
 * Rejects with every backend's reason when all of them fail.
 */
function firstAnswer(tasks: { name: string; run: () => Promise<AudioSource> }[]): Promise<AudioSource> {
  return new Promise((resolve, reject) => {
    const errors: string[] = [];
    let next = 0;
    let failed = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const launch = (): void => {
      if (done || next >= tasks.length) return;
      const i = next++;
      clearTimeout(timer);
      timer = setTimeout(launch, HEDGE_MS);
      tasks[i].run().then(
        (src) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(src);
        },
        (e) => {
          if (done) return;
          errors.push(`${tasks[i].name}: ${e instanceof Error ? e.message : String(e)}`);
          if (++failed === tasks.length) {
            done = true;
            clearTimeout(timer);
            reject(new Error(errors.join('\n')));
          } else if (i === next - 1) {
            launch(); // the newest one failed: the next one need not wait
          }
        },
      );
    };
    launch();
  });
}

/**
 * Resolve a playable audio URL for a videoId, trying the backends in order (a server of your own first, when set).
 * The others run side by side: see firstAnswer.
 * (Kotlin did the same: InnerTube → Piped / Invidious fallbacks.)
 */
export async function resolveAudio(videoId: string, opts: ResolverOptions = {}): Promise<AudioSource> {
  loadOnce();
  const hit = cache.get(videoId);
  if (hit && (!hit.expiresAt || hit.expiresAt - 60_000 > Date.now())) return hit;

  const run = (backend: StreamBackend): Promise<AudioSource> =>
    backend === 'server'
      ? server.resolve(videoId, opts.serverUrl ?? '', opts.serverKey)
      : backend === 'webpot'
        ? resolveWithPoToken(videoId)
        : backend === 'innertube'
          ? viaInnerTube(videoId)
          : backend === 'piped'
            ? piped.resolve(videoId, opts.pipedInstances)
            : invidious.resolve(videoId, opts.invidiousInstances);

  const base: StreamBackend[] = opts.order ?? ['webpot', 'piped', 'invidious'];
  const errors: string[] = [];
  let src: AudioSource | undefined;
  // your own server, when set, is asked first on its own
  if (opts.serverUrl?.trim()) {
    try {
      src = await run('server');
    } catch (e) {
      errors.push(`server: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!src) {
    const tasks = base.filter((b) => b !== 'server').map((b) => ({ name: b, run: () => run(b) }));
    if (tasks.length) {
      try {
        src = await firstAnswer(tasks);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }
  if (!src) throw new Error(`Could not resolve a stream for ${videoId}\n${errors.join('\n')}`);
  cache.set(videoId, src);
  persist();
  return src;
}

export function clearStreamCache() {
  cache.clear();
}
