/**
 * The "JS engine": a hidden WebView (see src/ui/EngineHost.tsx) that runs
 *   - YouTube's BotGuard (needs a real browser environment) to mint PO tokens, and
 *   - the yt-dlp "ejs" solver that decodes signature / `n` challenges from YouTube's player JS.
 * Core code only sees this small interface, so it can be tested with a fake.
 */
export interface JsEngine {
  call<T = unknown>(cmd: string, payload?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

/** What the WebView host reports about itself – shown in errors and in Settings → Diagnostics. */
export const engineStatus = {
  mounted: false,
  loadStarted: false,
  loadEnded: false,
  ready: false,
  probe: '' as string,
  errors: [] as string[],
  note(e: string) {
    engineStatus.errors = [...engineStatus.errors.slice(-4), e];
  },
  describe(): string {
    return (
      `mounted=${engineStatus.mounted} loadStarted=${engineStatus.loadStarted} loadEnded=${engineStatus.loadEnded} ready=${engineStatus.ready}` +
      (engineStatus.probe ? ` page=${engineStatus.probe}` : '') +
      (engineStatus.errors.length ? ` errors=[${engineStatus.errors.join(' | ')}]` : '')
    );
  },
};

let current: JsEngine | null = null;
let waiters: ((e: JsEngine) => void)[] = [];

export function setEngine(engine: JsEngine | null) {
  current = engine;
  engineStatus.ready = !!engine;
  if (engine) {
    const w = waiters;
    waiters = [];
    w.forEach((fn) => fn(engine));
  }
}

/** Waits (up to `timeoutMs`) for the WebView host to mount and finish loading. */
export function getEngine(timeoutMs = 15_000): Promise<JsEngine> {
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== onReady);
      reject(
        new Error(
          engineStatus.mounted
            ? `JS engine (hidden WebView) is not ready – ${engineStatus.describe()}`
            : 'JS engine host is not mounted – app/_layout.tsx must render <EngineHost />',
        ),
      );
    }, timeoutMs);
    const onReady = (e: JsEngine) => {
      clearTimeout(timer);
      resolve(e);
    };
    waiters.push(onReady);
  });
}
