import Storage from 'expo-sqlite/kv-store';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { START_DELAY_MS, TICK_MS } from '../core/updater';
import { type CheckResult, type PendingUpdate, Updater, type UpdaterState, type UpdatesApi } from '../core/updaterRuntime';
import { useOffline } from './offline';
import { usePlayer } from './player';
import { useSettings } from './settings';
import { useSongArchive } from './songArchive';

/**
 * An update while the app is open (the flow itself is core/updaterRuntime.ts). This file only connects it to the phone:
 * expo-updates, the clock, the player, the foreground / background of the app, and the little memory kept between starts.
 */
const BAD_KEY = 'ota.badIds.v1';
const ATTEMPT_KEY = 'ota.reloadAttempt.v1';
const SEEN_KEY = 'ota.lastSeenId.v1';

const readList = (key: string): string[] => {
  try {
    const v = JSON.parse(Storage.getItemSync(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-20) : [];
  } catch {
    return [];
  }
};

/** versions that did not start (the app fell back to the one inside it): they are not forced again */
let bad = new Set<string>(readList(BAD_KEY));

/**
 * Run once at start. The id of the version we asked to switch to was written down just before the reload:
 * if the app is running that version, it worked; if it fell back to the built-in one, that version is bad.
 */
export function trackReloadOutcome(): void {
  try {
    const attempt = Storage.getItemSync(ATTEMPT_KEY);
    if (!attempt) return;
    Storage.removeItemSync(ATTEMPT_KEY);
    if (Updates.isEmergencyLaunch) {
      bad.add(attempt);
      Storage.setItemSync(BAD_KEY, JSON.stringify([...bad].slice(-20)));
    }
  } catch {
    /* the memory is only a help */
  }
}

const updatesApi: UpdatesApi = {
  get isEnabled() {
    return Updates.isEnabled;
  },
  checkForUpdateAsync: () => Updates.checkForUpdateAsync() as ReturnType<UpdatesApi['checkForUpdateAsync']>,
  fetchUpdateAsync: () => Updates.fetchUpdateAsync() as ReturnType<UpdatesApi['fetchUpdateAsync']>,
  reloadAsync: () => Updates.reloadAsync(),
};

export const useUpdater = create<UpdaterState>(() => ({ phase: 'idle', pending: null, prompt: null, lastCheckAt: null, lastError: null }));

const updater = new Updater({
  updates: updatesApi,
  mode: () => useSettings.getState().otaApplyMode,
  situation: () => ({
    playing: usePlayer.getState().status === 'playing',
    // a reload would cut these in two
    working: useSongArchive.getState().phase !== 'idle' || Object.values(useOffline.getState().jobs).some((j) => j.status === 'queued' || j.status === 'downloading'),
  }),
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  onChange: (s) => useUpdater.setState(s),
  isBad: (id) => bad.has(id),
  markAttempt: (id) => {
    try {
      Storage.setItemSync(ATTEMPT_KEY, id);
    } catch {
      /* see above */
    }
  },
});

export const updaterActions = {
  /** look now (a person pressed the button) */
  checkNow: (): Promise<CheckResult> => updater.check('manual'),
  accept: (): void => updater.accept(),
  later: (): void => updater.later(),
  observePending: (p: PendingUpdate): void => updater.observePending(p),
};

/** the memory of "which update did I already say hello to" */
export const lastSeenUpdateId = (): string | null => {
  try {
    return Storage.getItemSync(SEEN_KEY);
  } catch {
    return null;
  }
};
export const rememberSeenUpdateId = (id: string): void => {
  try {
    Storage.setItemSync(SEEN_KEY, id);
  } catch {
    /* see above */
  }
};

/** Starts the looking: shortly after the start, whenever the app comes to the front, and now and then while it stays open. */
export function startUpdater(): () => void {
  trackReloadOutcome();
  const first = setTimeout(() => void updater.check('start'), START_DELAY_MS);
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void updater.check('foreground');
      updater.reevaluate();
    }
  });
  const tick = setInterval(() => void updater.check('tick'), TICK_MS);
  let lastStatus = usePlayer.getState().status;
  const unsubscribe = usePlayer.subscribe((s) => {
    if (s.status !== lastStatus) {
      lastStatus = s.status;
      updater.reevaluate(); // the music stopped: a waiting version may go in now
    }
  });
  return () => {
    clearTimeout(first);
    sub.remove();
    clearInterval(tick);
    unsubscribe();
  };
}
