import { SOLVER_CORE, SOLVER_LIB, SOLVER_VERSION } from './solver.generated';
import { getEngine } from './engine';

/**
 * Replacement for NewPipeExtractor's `YoutubeJavaScriptPlayerManager` (signature timestamp,
 * signature deciphering, `n` throttling parameter). The heavy lifting is done by yt-dlp's "ejs" solver,
 * which parses YouTube's player JS with meriyah + astring (far less brittle than regexes).
 */
export interface PlayerJs {
  id: string;
  url: string;
  text: string;
  /** signatureTimestamp for `playbackContext.contentPlaybackContext` */
  sts?: number;
}

let bundle = { lib: SOLVER_LIB, core: SOLVER_CORE };

/** test hook */
export function overrideSolverBundle(b: { lib: string; core: string }) {
  bundle = b;
}

let playerCache: { at: number; player: PlayerJs } | undefined;
let engineKnowsPlayer: string | undefined;
let solverLoaded = false;

/** NewPipe: read the current player id from iframe_api, then download base.js */
export async function getPlayerJs(maxAgeMs = 30 * 60_000): Promise<PlayerJs> {
  if (playerCache && Date.now() - playerCache.at < maxAgeMs) return playerCache.player;

  const api = await (await fetch('https://www.youtube.com/iframe_api')).text();
  const id = api.match(/player\\?\/([a-zA-Z0-9_-]{8})\\?\//)?.[1];
  if (!id) throw new Error('Could not find the current YouTube player id');

  if (playerCache?.player.id === id) {
    playerCache = { at: Date.now(), player: playerCache.player };
    return playerCache.player;
  }
  const url = `https://www.youtube.com/s/player/${id}/player_ias.vflset/en_US/base.js`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Player JS download failed: HTTP ${res.status}`);
  const text = await res.text();
  const sts = text.match(/(?:signatureTimestamp|sts)\s*[:=]\s*(\d{5})/)?.[1];
  const player = { id, url, text, sts: sts ? Number(sts) : undefined };
  playerCache = { at: Date.now(), player };
  return player;
}

async function ensureSolverLoaded() {
  if (solverLoaded) return;
  if (!bundle.core || !bundle.lib) {
    throw new Error('Challenge solver bundle is missing (run "npm run fetch-solver" before building the app)');
  }
  const engine = await getEngine();
  await engine.call('loadSolver', { lib: bundle.lib, core: bundle.core }, 30_000);
  solverLoaded = true;
}

export interface SolveRequest {
  n?: string[];
  sig?: string[];
}
export interface SolveResult {
  n: Record<string, string>;
  sig: Record<string, string>;
}

export async function solveChallenges(player: PlayerJs, req: SolveRequest): Promise<SolveResult> {
  await ensureSolverLoaded();
  const engine = await getEngine();
  const requests = [
    ...(req.n?.length ? [{ type: 'n', challenges: req.n }] : []),
    ...(req.sig?.length ? [{ type: 'sig', challenges: req.sig }] : []),
  ];
  const run = (withText: boolean) =>
    engine.call<{ responses: { type: string; data?: Record<string, string>; error?: string }[] }>(
      'solve',
      { playerId: player.id, player: withText ? player.text : undefined, requests },
      90_000,
    );

  let out;
  try {
    out = await run(engineKnowsPlayer !== player.id);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('jsc is not defined')) {
      // the WebView page was reloaded and lost the solver
      solverLoaded = false;
      await ensureSolverLoaded();
      out = await run(true);
    } else if (msg.includes('NEED_PLAYER')) {
      out = await run(true);
    } else {
      throw e;
    }
  }
  engineKnowsPlayer = player.id;

  const result: SolveResult = { n: {}, sig: {} };
  requests.forEach((r, i) => {
    const resp = out.responses[i];
    if (!resp || resp.type !== 'result' || !resp.data) {
      throw new Error(`Solving "${r.type}" challenge failed: ${resp?.error ?? 'no result'} (solver ${SOLVER_VERSION})`);
    }
    Object.assign(r.type === 'n' ? result.n : result.sig, resp.data);
  });
  return result;
}

/* ------------------------------------------------------------------ *
 * URL helpers – no `URL` / `URLSearchParams` (incomplete on Hermes)
 * ------------------------------------------------------------------ */

export function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of qs.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    const v = i < 0 ? '' : part.slice(i + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function getQueryParam(url: string, name: string): string | undefined {
  const q = url.split('#')[0].split('?')[1];
  if (!q) return undefined;
  for (const part of q.split('&')) {
    const i = part.indexOf('=');
    if ((i < 0 ? part : part.slice(0, i)) === name) {
      const raw = i < 0 ? '' : part.slice(i + 1);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}

export function setQueryParam(url: string, name: string, value: string): string {
  const [base, hash] = url.split('#');
  const [path, q = ''] = base.split('?');
  const enc = `${name}=${encodeURIComponent(value)}`;
  const parts = q ? q.split('&') : [];
  const idx = parts.findIndex((p) => (p.indexOf('=') < 0 ? p : p.slice(0, p.indexOf('='))) === name);
  if (idx >= 0) parts[idx] = enc;
  else parts.push(enc);
  return `${path}?${parts.join('&')}${hash ? `#${hash}` : ''}`;
}

export interface CipherFormat {
  url?: string;
  signatureCipher?: string;
  cipher?: string;
}

/**
 * Port of `NewPipeUtils.getStreamUrl` / `decodeSignatureCipher`:
 * plain `url`, or `signatureCipher` (s, sp, url) → deciphered url; then the `n` parameter is replaced.
 */
export async function getStreamUrl(format: CipherFormat, player: PlayerJs): Promise<string> {
  let url = format.url;
  let sig: { s: string; sp: string } | undefined;

  if (!url) {
    const cipher = format.signatureCipher ?? format.cipher;
    if (!cipher) throw new Error('Format has neither url nor signatureCipher');
    const p = parseQuery(cipher);
    if (!p.s || !p.url) throw new Error('Could not parse signatureCipher');
    url = p.url;
    sig = { s: p.s, sp: p.sp || 'signature' };
  }

  const n = getQueryParam(url, 'n');
  const solved = await solveChallenges(player, { n: n ? [n] : undefined, sig: sig ? [sig.s] : undefined });

  if (sig) url = setQueryParam(url, sig.sp, solved.sig[sig.s]);
  if (n) {
    const nn = solved.n[n];
    if (!nn || nn.startsWith('enhanced_except_')) throw new Error('Could not solve the "n" parameter');
    url = setQueryParam(url, 'n', nn);
  }
  return url;
}

export function resetSolverState() {
  playerCache = undefined;
  engineKnowsPlayer = undefined;
  solverLoaded = false;
}
