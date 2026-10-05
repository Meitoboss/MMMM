/**
 * Search-as-you-type, as plain logic (no React): waits for a pause in typing, throws away answers that arrive for a
 * query nobody is waiting for any more, and never repeats a search that is already shown or running.
 */
export interface LiveSearchHandlers<R> {
  /** the real search */
  search(query: string, filter: string | undefined): Promise<R>;
  onStart(query: string): void;
  onResult(query: string, filter: string | undefined, result: R): void;
  onError(query: string, filter: string | undefined, error: unknown): void;
  /** the box became empty */
  onClear(): void;
}

export const TYPING_PAUSE_MS = 400;

export class LiveSearch<R> {
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastKey: string | null = null;

  constructor(
    private readonly h: LiveSearchHandlers<R>,
    private readonly pauseMs = TYPING_PAUSE_MS,
  ) {}

  private key(q: string, filter: string | undefined): string {
    return `${filter ?? ''}\u0000${q}`;
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private clear(): void {
    this.seq += 1; // whatever is still on its way is of no interest any more
    this.lastKey = null;
    this.h.onClear();
  }

  /** every keystroke / filter change: the search starts after a pause */
  type(raw: string, filter?: string): void {
    this.stopTimer();
    const q = raw.trim();
    if (!q) return this.clear();
    if (this.key(q, filter) === this.lastKey) return; // already shown or running
    this.timer = setTimeout(() => void this.run(q, filter), this.pauseMs);
  }

  /** Enter, a tapped suggestion, a filter chip, "retry": no waiting. `force` repeats even the same search. */
  now(raw: string, filter?: string, force = false): Promise<void> {
    this.stopTimer();
    const q = raw.trim();
    if (!q) {
      this.clear();
      return Promise.resolve();
    }
    if (!force && this.key(q, filter) === this.lastKey) return Promise.resolve();
    return this.run(q, filter);
  }

  cancel(): void {
    this.stopTimer();
    this.seq += 1;
  }

  private async run(q: string, filter: string | undefined): Promise<void> {
    const my = ++this.seq;
    this.lastKey = this.key(q, filter);
    this.h.onStart(q);
    try {
      const result = await this.h.search(q, filter);
      if (my === this.seq) this.h.onResult(q, filter, result);
    } catch (e) {
      if (my === this.seq) {
        this.lastKey = null; // so that the same search can be tried again
        this.h.onError(q, filter, e);
      }
    }
  }
}
