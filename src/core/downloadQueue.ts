export type JobStatus = 'queued' | 'downloading' | 'done' | 'error';

export interface JobState {
  status: JobStatus;
  /** 0 … 1 */
  progress: number;
  error?: string;
}

export type JobRunner = (id: string, onProgress: (fraction: number) => void, isCancelled: () => boolean) => Promise<void>;

/**
 * Runs downloads one after another (a phone should not pull many streams at once).
 * Cancelling a queued job removes it; cancelling the running one asks it to stop and then moves on.
 */
export class DownloadQueue {
  private order: string[] = [];
  private cancelled = new Set<string>();
  private running = 0;
  private states = new Map<string, JobState>();

  constructor(
    private runner: JobRunner,
    private onChange: (id: string, state: JobState | null) => void,
    private concurrency = 1,
  ) {}

  has(id: string): boolean {
    const s = this.states.get(id);
    return !!s && (s.status === 'queued' || s.status === 'downloading');
  }

  /** false when the job is already waiting or running */
  enqueue(id: string): boolean {
    if (this.has(id)) return false;
    this.cancelled.delete(id);
    this.order.push(id);
    this.set(id, { status: 'queued', progress: 0 });
    void this.pump();
    return true;
  }

  cancel(id: string): void {
    const s = this.states.get(id);
    if (!s) return;
    if (s.status === 'queued') {
      this.order = this.order.filter((x) => x !== id);
      this.states.delete(id);
      this.onChange(id, null);
    } else if (s.status === 'downloading') {
      this.cancelled.add(id);
    }
  }

  /** forgets a finished / failed job (so it no longer shows up in lists) */
  clear(id: string): void {
    const s = this.states.get(id);
    if (s && (s.status === 'done' || s.status === 'error')) {
      this.states.delete(id);
      this.onChange(id, null);
    }
  }

  get(id: string): JobState | undefined {
    return this.states.get(id);
  }

  private set(id: string, state: JobState) {
    this.states.set(id, state);
    this.onChange(id, state);
  }

  private async pump(): Promise<void> {
    while (this.running < this.concurrency && this.order.length > 0) {
      const id = this.order.shift() as string;
      this.running += 1;
      void this.runOne(id).finally(() => {
        this.running -= 1;
        void this.pump();
      });
    }
  }

  private async runOne(id: string): Promise<void> {
    this.set(id, { status: 'downloading', progress: 0 });
    try {
      await this.runner(
        id,
        (p) => {
          const cur = this.states.get(id);
          if (cur?.status === 'downloading') this.set(id, { status: 'downloading', progress: Math.max(0, Math.min(1, p)) });
        },
        () => this.cancelled.has(id),
      );
      this.set(id, { status: 'done', progress: 1 });
    } catch (e) {
      if (this.cancelled.has(id)) {
        this.states.delete(id);
        this.onChange(id, null);
      } else {
        this.set(id, { status: 'error', progress: 0, error: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      this.cancelled.delete(id);
    }
  }
}
