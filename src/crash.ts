/**
 * Crash safety net. Imported FIRST by index.ts and deliberately free of top-level imports, so it still works when
 * another module fails while the app is starting.
 *
 *  - uncaught JS errors are written to storage before React Native turns them into a crash, and shown on the next launch
 *  - if the app cannot even load (an error while the modules are evaluated) a plain error screen is shown instead of closing
 */
declare const require: (id: string) => any;

export interface CrashRecord {
  at: string;
  fatal: boolean;
  message: string;
  stack: string;
}

interface CrashStorage {
  get(): string | null;
  set(v: string): void;
  del(): void;
}

const KEY = 'lastCrash.v1';
let storage: CrashStorage | null = null;

/** test hook */
export function setCrashStorage(s: CrashStorage | null) {
  storage = s;
}

function getStorage(): CrashStorage {
  if (storage) return storage;
  try {
    const kv = require('expo-sqlite/kv-store').default;
    storage = {
      get: () => kv.getItemSync(KEY),
      set: (v) => kv.setItemSync(KEY, v),
      del: () => kv.removeItemSync(KEY),
    };
  } catch {
    storage = { get: () => null, set: () => undefined, del: () => undefined };
  }
  return storage;
}

export function toRecord(error: unknown, fatal: boolean, now = new Date()): CrashRecord {
  const e = error as { message?: unknown; stack?: unknown } | null | undefined;
  return {
    at: now.toISOString(),
    fatal,
    message: String(e?.message ?? error ?? 'unknown error'),
    stack: String(e?.stack ?? '').split('\n').slice(0, 14).join('\n'),
  };
}

export function recordCrash(error: unknown, fatal: boolean) {
  try {
    getStorage().set(JSON.stringify(toRecord(error, fatal)));
  } catch {
    /* nothing more we can do */
  }
}

export function installCrashRecorder() {
  const utils = (globalThis as { ErrorUtils?: { setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void; getGlobalHandler?: () => ((e: unknown, fatal?: boolean) => void) | undefined } }).ErrorUtils;
  if (!utils?.setGlobalHandler) return;
  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, fatal) => {
    recordCrash(error, !!fatal);
    previous?.(error, fatal);
  });
}

export function readLastCrash(): CrashRecord | null {
  try {
    const raw = getStorage().get();
    return raw ? (JSON.parse(raw) as CrashRecord) : null;
  } catch {
    return null;
  }
}

export function clearLastCrash() {
  try {
    getStorage().del();
  } catch {
    /* ignore */
  }
}

/** Shown instead of the app when it could not start. */
export function registerStartupError(error: unknown) {
  const rec = toRecord(error, true);
  recordCrash(error, true);
  const React = require('react');
  const { AppRegistry, ScrollView, Text, View } = require('react-native');
  const Screen = () =>
    React.createElement(
      View,
      { style: { flex: 1, backgroundColor: '#0b0c10', paddingTop: 70, paddingHorizontal: 20 } },
      React.createElement(Text, { style: { color: '#ffffff', fontSize: 20, fontWeight: '800' } }, 'アプリを起動できませんでした'),
      React.createElement(Text, { style: { color: '#8f9499', marginTop: 8 } }, 'この画面のスクリーンショットを、開発者に送ってください。'),
      React.createElement(
        ScrollView,
        { style: { marginTop: 16 } },
        React.createElement(Text, { selectable: true, style: { color: '#ff6b6b', fontSize: 13 } }, rec.message),
        React.createElement(Text, { selectable: true, style: { color: '#8f9499', fontSize: 11, marginTop: 12 } }, rec.stack),
      ),
    );
  AppRegistry.registerComponent('main', () => Screen);
}
