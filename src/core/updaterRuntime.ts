import { shortError } from './ota';
import { type ApplyMode, type CheckReason, RELOAD_TIMEOUT_MS, SWITCH_DELAY_MS, type Situation, WAIT_POLL_MS, decide, noteFromManifest, shouldCheck } from './updater';

/**
 * The flow of an update while the app is open: look → download → (ask | wait | switch) → reload.
 * Everything that touches the phone (expo-updates, the clock, what the player is doing) is passed in, so the whole flow is tested
 * with a fake clock. A reload is never done twice for the same version, and a version that made the app fall back to the one
 * inside the app is not forced again.
 */
export interface UpdatesApi {
  readonly isEnabled: boolean;
  checkForUpdateAsync(): Promise<{ isAvailable: boolean; manifest?: unknown; isRollBackToEmbedded?: boolean }>;
  fetchUpdateAsync(): Promise<{ isNew?: boolean; manifest?: unknown; isRollBackToEmbedded?: boolean }>;
  reloadAsync(): Promise<void>;
}

export interface PendingUpdate {
  id: string;
  note: string | null;
}

export interface UpdaterState {
  phase: 'idle' | 'checking' | 'downloading' | 'switching';
  /** a version has been downloaded and waits to be used */
  pending: PendingUpdate | null;
  /** the question "apply now?" that is on the screen (null = none) */
  prompt: (PendingUpdate & { playing: boolean }) | null;
  lastCheckAt: number | null;
  lastError: string | null;
}

export interface UpdaterDeps {
  updates: UpdatesApi;
  mode(): ApplyMode;
  situation(): Situation;
  now(): number;
  /** runs `fn` after `ms`; returns a function that cancels it */
  schedule(fn: () => void, ms: number): () => void;
  onChange(state: UpdaterState): void;
  /** this version made the app fall back to the version inside the app, last time */
  isBad?(id: string): boolean;
  /** just before a reload for `id` (so that a bad start can be recognised afterwards) */
  markAttempt?(id: string): void;
}

export type CheckResult = 'none' | 'downloaded' | 'error' | 'skipped';

export class Updater {
  state: UpdaterState = { phase: 'idle', pending: null, prompt: null, lastCheckAt: null, lastError: null };
  private askedFor: string | null = null;
  private reloadFor: string | null = null;
  private cancelWait: (() => void) | null = null;
  private cancelSwitch: (() => void) | null = null;
  private cancelGiveUp: (() => void) | null = null;
  private disposed = false;

  constructor(private deps: UpdaterDeps) {}

  private set(patch: Partial<UpdaterState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.onChange(this.state);
  }

  /** looks for an update (rate-limited by `reason`) and downloads it */
  async check(reason: CheckReason): Promise<CheckResult> {
    const d = this.deps;
    if (this.disposed || !shouldCheck({ enabled: d.updates.isEnabled, busy: this.state.phase !== 'idle', pending: this.state.pending !== null, now: d.now(), lastCheckAt: this.state.lastCheckAt, reason })) return 'skipped';
    this.set({ phase: 'checking', lastCheckAt: d.now(), lastError: null });
    try {
      const r = await d.updates.checkForUpdateAsync();
      if (!r.isAvailable && !r.isRollBackToEmbedded) {
        this.set({ phase: 'idle' });
        return 'none';
      }
      this.set({ phase: 'downloading' });
      const f = await d.updates.fetchUpdateAsync();
      const rollback = Boolean(f.isRollBackToEmbedded ?? r.isRollBackToEmbedded);
      const manifest = f.manifest ?? r.manifest;
      const rawId = (manifest as { id?: unknown } | undefined)?.id;
      this.set({
        // the system may have announced the same download while it was still running, and a switch may already be on its way
        phase: this.state.phase === 'switching' ? 'switching' : 'idle',
        pending: { id: rollback ? 'rollback' : typeof rawId === 'string' && rawId ? rawId : 'unknown', note: rollback ? 'アプリに入っている版へ、戻します' : noteFromManifest(manifest) },
      });
      this.afterPending();
      return 'downloaded';
    } catch (e) {
      this.set({ phase: this.state.phase === 'switching' ? 'switching' : 'idle', lastError: shortError(e) });
      return 'error';
    }
  }

  /** the system downloaded a version by itself (at start-up): treat it like one found here; null = there is none (any more) */
  observePending(info: PendingUpdate | null): void {
    if (this.disposed) return;
    if (info === null) {
      if (this.state.pending && this.state.phase !== 'switching') this.set({ pending: null, prompt: null });
      return;
    }
    if (this.state.pending?.id === info.id) return;
    this.set({ pending: info });
    this.afterPending();
  }

  /** "apply now" (from the pop-up, or from a button) */
  accept(): void {
    if (this.state.prompt) this.set({ prompt: null });
    this.switchNow();
  }

  /** "later": no more questions about this version */
  later(): void {
    if (this.state.prompt) this.set({ prompt: null });
  }

  /** something changed (the music stopped, a job ended): think again about a waiting version */
  reevaluate(): void {
    if (this.state.pending && this.state.phase === 'idle') this.afterPending();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelWait?.();
    this.cancelSwitch?.();
    this.cancelGiveUp?.();
  }

  private afterPending(): void {
    this.cancelWait?.();
    this.cancelWait = null;
    const p = this.state.pending;
    if (this.disposed || !p || this.reloadFor === p.id || this.state.phase === 'switching') return;
    const sit = this.deps.situation();
    const decision = decide(this.deps.mode(), sit, this.askedFor === p.id, this.deps.isBad?.(p.id) ?? false);
    if (decision === 'prompt') {
      this.askedFor = p.id;
      this.set({ prompt: { ...p, playing: sit.playing } });
    } else if (decision === 'switch') {
      this.switchNow();
    } else if (decision === 'wait') {
      this.cancelWait = this.deps.schedule(() => {
        this.cancelWait = null;
        this.afterPending();
      }, WAIT_POLL_MS);
    }
  }

  private switchNow(): void {
    const p = this.state.pending;
    if (this.disposed || !p || this.state.phase === 'switching' || this.cancelSwitch || this.reloadFor === p.id) return;
    this.cancelWait?.();
    this.cancelWait = null;
    this.set({ phase: 'switching', prompt: null });
    this.cancelSwitch = this.deps.schedule(() => void this.reload(p.id), SWITCH_DELAY_MS);
  }

  private async reload(id: string): Promise<void> {
    this.cancelSwitch = null;
    if (this.reloadFor === id) return; // never twice for the same version
    this.reloadFor = id;
    this.deps.markAttempt?.(id);
    // if this code is still running a long time after the reload was asked for, the reload did not happen
    this.cancelGiveUp = this.deps.schedule(() => {
      if (this.state.phase === 'switching') {
        this.reloadFor = null;
        this.set({ phase: 'idle', lastError: '切り替えられませんでした' });
      }
    }, RELOAD_TIMEOUT_MS);
    try {
      await this.deps.updates.reloadAsync();
    } catch (e) {
      this.cancelGiveUp?.();
      this.reloadFor = null;
      this.set({ phase: 'idle', lastError: shortError(e) });
    }
  }
}
