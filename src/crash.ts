/**
 * Crash safety net. Imported FIRST by index.ts and deliberately free of top-level imports, so it still works when
 * another module fails while the app is starting.
 *
 *  - uncaught JS errors are written to storage before React Native turns them into a crash, and shown on the next launch
 *  - if the app cannot even load (an error while the modules are evaluated) a plain error screen is shown instead of closing
 *  - after a fatal error the NEXT start shows what went wrong on its very first screen, steady (an app that dies a second
 *    after it opens would otherwise flash the message for a moment), with a button to share it and one to open the app
 *  - when there is nothing for expo-updates to fall back to (updates off, or the version built into the app is the one running),
 *    a fatal error does not close the app at all: the error is shown AT ONCE, with the same buttons
 */
declare const require: (id: string) => any;

export interface CrashRecord {
  at: string;
  fatal: boolean;
  message: string;
  stack: string;
  /** how the app was running: updates on/off, the built-in version or an update, the update's id */
  info?: string;
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

/** "updates: on · update 1a2b… · runtime 1" – found out only when something has gone wrong, and never allowed to fail */
export function launchInfo(): string | undefined {
  try {
    const U = require('expo-updates');
    if (!U.isEnabled) return 'updates: off';
    const parts = ['updates: on', U.isEmbeddedLaunch ? 'built-in version' : `update ${String(U.updateId ?? '?').slice(0, 8)}…`];
    if (U.runtimeVersion) parts.push(`runtime ${U.runtimeVersion}`);
    if (U.isEmergencyLaunch) parts.push('emergency launch');
    return parts.join(' · ');
  } catch {
    return undefined;
  }
}

/** writes the error down; returns the record (null when even that was not possible) */
export function recordCrash(error: unknown, fatal: boolean): CrashRecord | null {
  try {
    const info = launchInfo();
    const rec: CrashRecord = { ...toRecord(error, fatal), ...(info ? { info } : {}) };
    getStorage().set(JSON.stringify(rec));
    return rec;
  } catch {
    return null; /* nothing more we can do */
  }
}

type FatalListener = (rec: CrashRecord) => void;
const fatalListeners = new Set<FatalListener>();
/** the screen that can show a fatal error right away says so here (returns the way to stop listening) */
export function onFatalError(listener: FatalListener): () => void {
  fatalListeners.add(listener);
  return () => void fatalListeners.delete(listener);
}

let stayOpenCheck: (() => boolean) | null = null;
/** test hook */
export function setStayOpenCheck(f: (() => boolean) | null) {
  stayOpenCheck = f;
}

/**
 * May the app stay open after a fatal error? Only when expo-updates has nothing to fall back to: updates are off, or the version built
 * into the app is already the one running. When an UPDATE is running, the error must reach expo-updates: it starts the version that
 * is built in, which is what saves the app from a bad update.
 */
export function canStayOpenAfterFatal(): boolean {
  if (stayOpenCheck) return stayOpenCheck();
  try {
    const U = require('expo-updates');
    return !U.isEnabled || !!U.isEmbeddedLaunch || !!U.isEmergencyLaunch;
  } catch {
    return true;
  }
}

export function installCrashRecorder() {
  const utils = (globalThis as { ErrorUtils?: { setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void; getGlobalHandler?: () => ((e: unknown, fatal?: boolean) => void) | undefined } }).ErrorUtils;
  if (!utils?.setGlobalHandler) return;
  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, fatal) => {
    const rec = recordCrash(error, !!fatal);
    if (fatal && rec && fatalListeners.size > 0 && canStayOpenAfterFatal()) {
      try {
        fatalListeners.forEach((l) => l(rec));
        return; // the error is on the screen; the app is not closed
      } catch {
        /* the screen could not be shown: fall through to the normal way */
      }
    }
    previous?.(error, fatal);
  });
}

/** a stored record is not trusted: anything that is not a record is "no record" */
export function validRecord(x: unknown): CrashRecord | null {
  const r = x as Partial<CrashRecord> | null;
  if (!r || typeof r !== 'object' || typeof r.message !== 'string' || typeof r.stack !== 'string' || typeof r.at !== 'string' || typeof r.fatal !== 'boolean') return null;
  return { at: r.at.slice(0, 40), fatal: r.fatal, message: r.message.slice(0, 2000), stack: r.stack.slice(0, 4000), ...(typeof r.info === 'string' ? { info: r.info.slice(0, 300) } : {}) };
}

export function readLastCrash(): CrashRecord | null {
  try {
    const raw = getStorage().get();
    return raw ? validRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** 2026-10-10 19:33:32 in the phone's own time */
export function localStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** the text that is shared: everything needed to find the cause */
export function crashText(rec: CrashRecord): string {
  return ['Music space: 前回の異常終了', `時刻: ${localStamp(rec.at)}${rec.fatal ? '' : '（致命的ではないエラー）'}`, ...(rec.info ? [`実行: ${rec.info}`] : []), '', rec.message, '', rec.stack].join('\n');
}

/** only a fatal error (the app was closed because of it) is worth a screen of its own; the smaller ones keep the little notice */
export const shouldShowSafeScreen = (rec: CrashRecord | null): rec is CrashRecord => !!rec && rec.fatal === true;

interface SafeModeDeps {
  AppRegistry?: { registerComponent: (name: string, provider: () => unknown, ...rest: unknown[]) => unknown };
}

/**
 * The root of the app is wrapped. If the last run ended with a fatal error, its first screen is the error (steady, shareable) and the
 * app itself is opened only by "アプリを開く". And during the run, a fatal error that expo-updates could not recover from is shown here
 * at once instead of closing the app. Must be called before the app registers its root. Returns a function that undoes it.
 */
export function installSafeMode(deps: SafeModeDeps = {}): () => void {
  const noop = () => undefined;
  const last = readLastCrash();
  const record = shouldShowSafeScreen(last) ? last : null;
  let registry = deps.AppRegistry;
  if (!registry) {
    try {
      registry = require('react-native').AppRegistry;
    } catch {
      return noop;
    }
  }
  if (!registry) return noop;
  const reg = registry;
  const original = reg.registerComponent;
  reg.registerComponent = function (this: unknown, name: string, provider: () => unknown, ...rest: unknown[]) {
    if (name !== 'main') return original.call(this, name, provider, ...rest);
    reg.registerComponent = original; // only the app's root is wrapped, and only once
    return original.call(this, name, () => makeSafeRoot(provider, record), ...rest);
  };
  return () => {
    reg.registerComponent = original;
  };
}

function makeSafeRoot(provider: () => unknown, initial: CrashRecord | null): unknown {
  const React = require('react');
  const { Pressable, ScrollView, Share, Text, View } = require('react-native');
  const Real = provider() as never;
  const button = (label: string, onPress: () => void, primary: boolean, testID: string) =>
    React.createElement(
      Pressable,
      { testID, onPress, style: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: primary ? '#82e653' : '#2a2d36' } },
      React.createElement(Text, { style: { color: primary ? '#0b0c10' : '#ffffff', fontWeight: '800', fontSize: 15 } }, label),
    );
  /** starts the app's JavaScript again; false when that is not possible here */
  const restart = (): boolean => {
    try {
      const U = require('expo-updates');
      if (U.isEnabled) {
        void U.reloadAsync();
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  };
  return function SafeRoot(props: Record<string, unknown>) {
    // null: the app; "last": the error of the previous run; "now": a fatal error that has just happened
    const [view, setView] = React.useState(initial ? { kind: 'last', rec: initial } : null);
    const [hint, setHint] = React.useState('');
    React.useEffect(() => onFatalError((rec) => setView({ kind: 'now', rec })), []);
    if (!view) return React.createElement(Real, props);
    const now = view.kind === 'now';
    const rec: CrashRecord = view.rec;
    return React.createElement(
      View,
      { testID: 'safe-screen', style: { flex: 1, backgroundColor: '#0b0c10', paddingTop: 70, paddingHorizontal: 20, paddingBottom: 40 } },
      React.createElement(Text, { testID: 'safe-title', style: { color: '#ffffff', fontSize: 20, fontWeight: '800' } }, now ? 'アプリでエラーが起きました' : '前回、アプリが異常終了しました'),
      React.createElement(Text, { style: { color: '#8f9499', marginTop: 8, fontSize: 13 } }, `${localStamp(rec.at)}\nこの文章を、開発者に、送ってください（「共有」）。`),
      React.createElement(
        ScrollView,
        { style: { marginTop: 16 } },
        React.createElement(Text, { testID: 'safe-message', selectable: true, style: { color: '#ff6b6b', fontSize: 14 } }, rec.message),
        rec.info ? React.createElement(Text, { selectable: true, style: { color: '#82e653', fontSize: 12, marginTop: 10 } }, rec.info) : null,
        React.createElement(Text, { selectable: true, style: { color: '#8f9499', fontSize: 11, marginTop: 12 } }, rec.stack),
      ),
      hint ? React.createElement(Text, { testID: 'safe-hint', style: { color: '#ffd166', fontSize: 13, marginTop: 12 } }, hint) : null,
      React.createElement(
        View,
        { style: { flexDirection: 'row', gap: 12, marginTop: 16 } },
        button('共有', () => void Promise.resolve(Share.share({ message: crashText(rec) })).catch(() => undefined), false, 'safe-share'),
        now
          ? button('もう一度起動', () => { if (!restart()) setHint('アプリを、いったん閉じて（アプリの切り替え画面で、上へスワイプ）、開き直してください。'); }, true, 'safe-continue')
          : button('アプリを開く', () => { clearLastCrash(); setView(null); }, true, 'safe-continue'),
      ),
    );
  };
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
