import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';
import { type NormalizeMode } from '../core/loudness';
import { create } from 'zustand';

import { type AudioQuality, DEFAULT_INVIDIOUS_INSTANCES, DEFAULT_PIPED_INSTANCES, IOS, WEB_REMIX, configure } from '../core/config';
import { configureRemotePot } from '../core/pot/remote';
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
  /** your own server/server.mjs, e.g. http://192.168.1.10:8787 */
  streamServerUrl: string;
  streamServerKey: string;
  /** a bgutil token server, e.g. https://1-2-3-4.sslip.io – mints PO tokens instead of this phone's WebView */
  potServerUrl: string;
  potServerKey: string;
  /** which audio stream to play: standard (AAC ≈128 kbps) / saver (the smallest) / high (Android: the highest bitrate) */
  audioQuality: AudioQuality;
  /** Apple Music chart: storefront (jp, us, kr …) and how many songs (10 / 25 / 50 / 100) */
  trendingCountry: string;
  trendingLimit: number;
  /** where the "a new version is out" information lives (version.json); empty = never look */
  updateFeedUrl: string;
  /** seconds of fade out / fade in between songs (0 = off) */
  fadeSeconds: number;
  /** even out the volume between songs */
  volumeNormalize: NormalizeMode;
  /** keep the queue and position, and offer them again at the next start */
  resumeOnLaunch: boolean;
  /** show the playback event log on the player screen */
  showDebug: boolean;
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
  streamOrder: ['webpot', 'piped', 'invidious'],
  pipedInstances: DEFAULT_PIPED_INSTANCES,
  invidiousInstances: DEFAULT_INVIDIOUS_INSTANCES,
  streamServerUrl: '',
  streamServerKey: '',
  potServerUrl: '',
  potServerKey: '',
  audioQuality: 'standard',
  trendingCountry: 'jp',
  trendingLimit: 25,
  updateFeedUrl: '',
  fadeSeconds: 0,
  volumeNormalize: 'standard',
  resumeOnLaunch: true,
  showDebug: false,
  autoRadio: true,
  autoLyrics: true,
  playbackRate: 1,
};

const KEY = 'settings.v1';

function load(): Settings {
  try {
    const raw = Storage.getItemSync(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
    // older builds used the (now blocked) InnerTube iOS client first
    if (saved.streamOrder.includes('innertube')) saved.streamOrder = DEFAULT_SETTINGS.streamOrder;
    return saved;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Push the user-facing settings into the core library. */
export function applySettings(s: Settings) {
  configureRemotePot({ url: s.potServerUrl, key: s.potServerKey });
  configure({
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    quality: s.audioQuality === 'saver' || s.audioQuality === 'high' ? s.audioQuality : 'standard',
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
  return {
    order: s.streamOrder,
    pipedInstances: s.pipedInstances,
    invidiousInstances: s.invidiousInstances,
    serverUrl: s.streamServerUrl,
    serverKey: s.streamServerKey,
  };
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
