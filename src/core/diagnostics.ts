import { resolveWithPoToken, ensureVisitorData } from './innertube/webpot';
import { engineStatus, getEngine } from './pot/engine';
import { poTokenProvider } from './pot/potoken';
import { getRemotePotConfig, isRemotePotConfigured, mintRemote, pingRemote } from './pot/remote';
import { SOLVER_VERSION } from './pot/solver.generated';
import { getPlayerJs, solveChallenges } from './pot/solver';

export interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

/**
 * Walks through every stage of "PO token playback" and reports where it breaks.
 * Shown in Settings → Diagnostics so a failure on the phone can be pinpointed from one screenshot.
 */
export async function runSelfTest(onStep: (r: StepResult) => void, videoId = 'dQw4w9WgXcQ'): Promise<boolean> {
  async function step<T>(name: string, fn: () => Promise<T>, describe: (v: T) => string): Promise<T | undefined> {
    const t0 = Date.now();
    try {
      const v = await fn();
      onStep({ name, ok: true, detail: describe(v), ms: Date.now() - t0 });
      return v;
    } catch (e) {
      onStep({ name, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
      return undefined;
    }
  }

  const engine = await step('1. WebView engine ready', () => getEngine(10_000), () => engineStatus.describe());
  if (!engine) return false;
  if (!(await step('2. Engine answers', () => engine.call<string>('ping'), (v) => v))) return false;

  const vd = await step('3. visitorData', () => ensureVisitorData(), (v) => `${v.slice(0, 12)}… (${v.length} chars)`);
  if (!vd) return false;

  const pot = await step(
    '4. BotGuard → PO token',
    () => poTokenProvider.getWebClientPoToken(videoId, vd, true),
    (v) => `player token ${v.player.length} chars, streaming token ${v.streaming.length} chars`,
  );
  if (!pot) return false;

  const player = await step('5. Player JS', () => getPlayerJs(0), (p) => `id ${p.id}, signatureTimestamp ${p.sts ?? 'NOT FOUND'}, ${(p.text.length / 1024) | 0} KB`);
  if (!player) return false;

  const solved = await step(
    `6. Challenge solver (ejs ${SOLVER_VERSION})`,
    () => solveChallenges(player, { n: ['abcdefghijklmnopq'] }),
    (r) => `n → ${Object.values(r.n)[0]}`,
  );
  if (!solved) return false;

  return !!(await step(
    '7. Full resolve + stream probe',
    () => resolveWithPoToken(videoId),
    (s) => `itag ${s.itag}, ${s.url.split('/')[2]}, ${((s.contentLength ?? 0) / 1e6).toFixed(1)} MB`,
  ));
}

/** Settings → Diagnostics → "Test token server": can the phone reach it, is the key accepted, does it mint tokens? */
export async function runTokenServerTest(onStep: (r: StepResult) => void, videoId = 'cy-4YL--Cm8'): Promise<boolean> {
  if (!isRemotePotConfigured()) {
    onStep({ name: 'Token server', ok: false, detail: 'Enter "Token server URL" (and key) in Settings first.', ms: 0 });
    return false;
  }
  const cfg = getRemotePotConfig()!;
  let t0 = Date.now();
  try {
    const pong = await pingRemote();
    onStep({ name: `1. ${cfg.url} /ping`, ok: true, detail: pong.slice(0, 120), ms: Date.now() - t0 });
  } catch (e) {
    onStep({ name: `1. ${cfg.url} /ping`, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
    return false;
  }
  t0 = Date.now();
  try {
    const t = await mintRemote(videoId);
    onStep({ name: '2. mint a token', ok: true, detail: `${t.length} chars: ${t.slice(0, 16)}…`, ms: Date.now() - t0 });
    return true;
  } catch (e) {
    onStep({ name: '2. mint a token', ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
    return false;
  }
}
