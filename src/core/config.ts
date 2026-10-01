/**
 * InnerTube configuration.
 *
 * IMPORTANT: In the Kotlin project every value below was read from Android string
 * resources named `env_xxxxxxxxxx` (see `InitializeEnvironment()` in EnvironmentUtils.kt).
 * Those resources are NOT part of the public repository, so the concrete values could not be
 * ported 1:1. The defaults here are the publicly known YouTube Music web / iOS client
 * identifiers. They go stale over time – override them at runtime with `configure()`
 * (the app exposes this in Settings → Advanced).
 */
export interface ClientProfile {
  clientName: string;
  clientVersion: string;
  /** numeric id used in the X-YouTube-Client-Name header */
  xClientName: number;
  userAgent?: string;
  osName?: string;
  osVersion?: string;
  deviceMake?: string;
  deviceModel?: string;
}

export const WEB_REMIX: ClientProfile = {
  clientName: 'WEB_REMIX',
  clientVersion: '1.20250310.01.00',
  xClientName: 67,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
};

/** Used for `player`: returns directly playable (non-ciphered) URLs, AAC/m4a on iOS. */
export const IOS: ClientProfile = {
  clientName: 'IOS',
  clientVersion: '19.45.4',
  xClientName: 5,
  userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
  osName: 'iOS',
  osVersion: '18.1.0.22B83',
  deviceMake: 'Apple',
  deviceModel: 'iPhone16,2',
};

export interface InnerTubeConfig {
  host: string;
  /** path prefix, e.g. /youtubei/v1 */
  apiPath: string;
  origin: string;
  hl: string;
  gl: string;
  visitorData?: string;
  /** raw Cookie header, only needed for logged-in features (not ported yet) */
  cookie?: string;
  web: ClientProfile;
  ios: ClientProfile;
}

export const defaultConfig: InnerTubeConfig = {
  host: 'music.youtube.com',
  apiPath: '/youtubei/v1',
  origin: 'https://music.youtube.com',
  hl: 'en',
  gl: 'US',
  web: WEB_REMIX,
  ios: IOS,
};

let current: InnerTubeConfig = { ...defaultConfig };

export function getConfig(): InnerTubeConfig {
  return current;
}

export function configure(patch: Partial<InnerTubeConfig>): InnerTubeConfig {
  current = { ...current, ...patch };
  return current;
}

/** Piped instances copied from `Environment.listPipedInstances` */
export const DEFAULT_PIPED_INSTANCES = [
  'https://pipedapi.nosebs.ru',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.syncpundit.io',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.r4fo.com',
  'https://yapi.vyper.me',
  'https://pipedapi-libre.kavin.rocks',
];

/** Invidious instances from `Instances.kt` (YEWTU / NADEKO) */
export const DEFAULT_INVIDIOUS_INSTANCES = ['https://yewtu.be', 'https://inv.nadeko.net'];
