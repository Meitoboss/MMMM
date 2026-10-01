import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { DEFAULT_INVIDIOUS_INSTANCES, DEFAULT_PIPED_INSTANCES, IOS, WEB_REMIX, configure } from '../core/config';
import type { ResolverOptions, StreamBackend } from '../core/streams/resolver';

export interface Settings {
  hl: string;
  gl: string;
  /** Override when YouTube rejects the bundled client version (see core/config.ts) */
  webClientVersion: string;
  iosClientVersion: string;
  streamOrder: StreamBackend[];
  pipedInstances: string[];
  invidiousInstances: string[];
  /** keep playing similar songs when the queue ends */
  autoRadio: boolean;
  /** fetch lyrics automatically on the player screen */
  autoLyrics: boolean;
  playbackRate: number;
}

export const DEFAULT_SETTINGS: Settings = {
  hl: 'en',
  gl: 'US',
  webClientVersion: WEB_REMIX.clientVersion,
  iosClientVersion: IOS.clientVersion,
  streamOrder: ['innertube', 'piped', 'invidious'],
  pipedInstances: DEFAULT_PIPED_INSTANCES,
  invidiousInstances: DEFAULT_INVIDIOUS_INSTANCES,
  autoRadio: true,
  autoLyrics: true,
  playbackRate: 1,
};

const KEY = 'settings.v1';

function load(): Settings {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Push the user-facing settings into the core library. */
export function applySettings(s: Settings) {
  configure({
    hl: s.hl,
    gl: s.gl,
    web: { ...WEB_REMIX, clientVersion: s.webClientVersion },
    ios: {
      ...IOS,
      clientVersion: s.iosClientVersion,
      userAgent: IOS.userAgent?.replace(IOS.clientVersion, s.iosClientVersion),
    },
  });
}

export function resolverOptions(s: Settings = useSettings.getState()): ResolverOptions {
  return { order: s.streamOrder, pipedInstances: s.pipedInstances, invidiousInstances: s.invidiousInstances };
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    const { update: _u, reset: _r, ...plain } = get();
    Storage.setItemSync(KEY, JSON.stringify(plain));
    applySettings(plain);
  },
  reset: () => {
    Storage.removeItemSync(KEY);
    set(DEFAULT_SETTINGS);
    applySettings(DEFAULT_SETTINGS);
  },
}));
