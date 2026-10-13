/**
 * Applying an over-the-air update while the app is open: when to look, what to say, when it is fine to switch.
 * Pure rules – the calls into expo-updates are in updaterRuntime.ts / state/updater.ts, so all of this can be tested.
 */
export type ApplyMode = 'ask' | 'auto' | 'manual';
export const DEFAULT_APPLY_MODE: ApplyMode = 'ask';
export const APPLY_MODES: { value: ApplyMode; label: string; hint: string }[] = [
  { value: 'ask', label: '確認してから', hint: '取得したら、ポップアップで聞きます（おすすめ）' },
  { value: 'auto', label: '自動', hint: '音楽を再生していないときに、自動で切り替えます' },
  { value: 'manual', label: '自分で', hint: '取得だけします。反映は、ホームか設定から、自分で押します' },
];
export const isApplyMode = (v: unknown): v is ApplyMode => v === 'ask' || v === 'auto' || v === 'manual';

/** after the app opens: wait a moment first, so that the start is not slowed down */
export const START_DELAY_MS = 3000;
/** coming back to the app: look again only if the last look was this long ago */
export const FOREGROUND_GAP_MS = 10 * 60_000;
/** while the app stays open: look this often */
export const PERIODIC_GAP_MS = 60 * 60_000;
export const TICK_MS = 5 * 60_000;
/** waiting for the music to stop (or a job to finish): look again this often */
export const WAIT_POLL_MS = 3000;
/** the "switching" screen is shown this long before the app reloads, so that it does not look like a crash */
export const SWITCH_DELAY_MS = 900;
/** if the app is still here this long after asking for a reload, the reload did not happen */
export const RELOAD_TIMEOUT_MS = 12_000;

export type CheckReason = 'start' | 'foreground' | 'tick' | 'manual';

export function shouldCheck(o: { enabled: boolean; busy: boolean; pending: boolean; now: number; lastCheckAt: number | null; reason: CheckReason }): boolean {
  if (!o.enabled || o.busy) return false;
  if (o.reason === 'manual') return true;
  if (o.pending) return false; // it is downloaded already: nothing more to look for
  const gap = o.lastCheckAt === null ? Number.POSITIVE_INFINITY : o.now - o.lastCheckAt;
  if (o.reason === 'start') return gap >= 30_000;
  if (o.reason === 'foreground') return gap >= FOREGROUND_GAP_MS;
  return gap >= PERIODIC_GAP_MS;
}

export interface Situation {
  /** music is playing */
  playing: boolean;
  /** a long job is running (saving songs, writing or restoring a song file) – a reload would break it */
  working: boolean;
}
export type Decision = 'prompt' | 'switch' | 'wait' | 'leave';

/**
 * A new version has been downloaded. What now?
 *  ask:    ask once per version (in a pop-up) – but not in the middle of a long job
 *  auto:   switch when nothing is playing and no job runs; otherwise wait
 *  manual: leave it – the person presses "apply" in Home or Settings
 */
export function decide(mode: ApplyMode, sit: Situation, alreadyAsked: boolean, bad = false): Decision {
  if (bad) return 'leave'; // this very version did not start last time: it is not forced again
  if (mode === 'manual') return 'leave';
  if (mode === 'auto') return sit.playing || sit.working ? 'wait' : 'switch';
  if (alreadyAsked) return 'leave';
  return sit.working ? 'wait' : 'prompt';
}

/** the release note a person wrote: no control characters, no long runs of blank lines, not too long */
export function cleanNote(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!t) return null;
  const letters = Array.from(t);
  return letters.length > 400 ? `${letters.slice(0, 399).join('')}…` : t;
}

/** the note that travels inside the (signed) manifest of an update: extra.releaseNote */
export function noteFromManifest(manifest: unknown): string | null {
  const m = manifest as { extra?: { releaseNote?: unknown } } | null | undefined;
  return cleanNote(m?.extra?.releaseNote);
}

export function promptContent(note: string | null, sit: Situation): { title: string; message: string } {
  return {
    title: '新しい版を取得しました',
    message: [note ?? 'アプリの中身が、新しくなりました。', '', sit.playing ? '反映すると、再生中の音楽が一度止まります（もう一度、再生してください）。' : 'いま反映すると、アプリを閉じずに、新しい版に切り替わります。'].join('\n'),
  };
}

export function appliedContent(note: string | null): { title: string; message: string } {
  return { title: '更新しました', message: note ?? 'アプリの中身を、新しい版にしました。' };
}

export function emergencyContent(reason: string | null): { title: string; message: string } {
  return { title: '新しい版を起動できませんでした', message: `取得した新しい版が、うまく起動しなかったため、アプリに入っている版で動いています。${reason ? `\n（${reason}）` : ''}\n\nこの版は、もう自動では切り替えません。` };
}

/** is this the first start with this update (so that "what changed" is shown once)? */
export function shouldShowApplied(lastSeenId: string | null, currentId: string | null, embedded: boolean): boolean {
  return !embedded && !!currentId && currentId !== lastSeenId;
}
