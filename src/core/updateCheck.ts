/**
 * "A new version is out": the app reads a small file (version.json, made by the release workflow) and compares versions.
 * No store, no new native module – the app only says so and opens the place where the new version can be taken
 * (AltStore on an iPhone, the APK on Android).
 */
export interface UpdateFeed {
  version: string;
  build?: string;
  date?: string;
  notes?: string;
  iosUrl?: string;
  /** the AltStore source (altstore.json) – AltStore finds the new IPA there */
  altstoreSource?: string;
  androidUrl?: string;
  pageUrl?: string;
}

export type UpdateResult = { kind: 'newer'; feed: UpdateFeed; target?: string } | { kind: 'current'; feed: UpdateFeed } | { kind: 'error'; message: string };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isDigits = (s: string): boolean => s.length > 0 && s.length <= 6 && [...s].every((c) => c >= '0' && c <= '9');
export const isHttpUrl = (u: string): boolean => (u.startsWith('https://') || u.startsWith('http://')) && u.length > 10 && !u.includes(' ');

/** "1", "1.0", "1.0.1", "1.0.1.2": numbers separated by dots, nothing else */
export function validVersion(v: string): boolean {
  const parts = v.split('.');
  return parts.length >= 1 && parts.length <= 4 && parts.every(isDigits);
}

/** 1 if a is newer, -1 if older, 0 if the same ("1.0.10" is newer than "1.0.9"; a missing part is 0) */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** only what is really there and really a web address is kept */
export function parseFeed(json: unknown): UpdateFeed | null {
  const o = obj(json);
  if (!o) return null;
  const version = str(o.version);
  if (!validVersion(version)) return null;
  const url = (v: unknown): string | undefined => (isHttpUrl(str(v)) ? str(v) : undefined);
  const ios = obj(o.ios);
  const android = obj(o.android);
  return {
    version,
    ...(str(o.build) ? { build: str(o.build) } : {}),
    ...(str(o.date) ? { date: str(o.date).slice(0, 20) } : {}),
    ...(str(o.notes) ? { notes: str(o.notes).slice(0, 300) } : {}),
    ...(url(ios?.url) ? { iosUrl: url(ios?.url) } : {}),
    ...(url(ios?.altstoreSource) ? { altstoreSource: url(ios?.altstoreSource) } : {}),
    ...(url(android?.url) ? { androidUrl: url(android?.url) } : {}),
    ...(url(o.page) ? { pageUrl: url(o.page) } : {}),
  };
}

/** altstore://source?url=… adds the source in AltStore (and shows its apps with their updates) */
export const altstoreLink = (sourceUrl: string): string => `altstore://source?url=${encodeURIComponent(sourceUrl)}`;

/** where "開く" goes: iPhone → AltStore (else the release page), Android → the APK (else the release page) */
export function updateTarget(feed: UpdateFeed, platform: 'ios' | 'android'): string | undefined {
  if (platform === 'ios') return feed.altstoreSource ? altstoreLink(feed.altstoreSource) : (feed.pageUrl ?? feed.iosUrl);
  return feed.androidUrl ?? feed.pageUrl;
}

export async function checkForUpdate(feedUrl: string, current: string, platform: 'ios' | 'android', getJson: (url: string) => Promise<unknown>): Promise<UpdateResult> {
  const url = feedUrl.trim();
  if (!isHttpUrl(url)) return { kind: 'error', message: '更新情報のURLが正しくありません（https:// で始まるアドレスを入れてください）' };
  let json: unknown;
  try {
    json = await getJson(url);
  } catch (e) {
    return { kind: 'error', message: `更新情報を取得できませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
  const feed = parseFeed(json);
  if (!feed) return { kind: 'error', message: '更新情報の形式が正しくありません' };
  return compareVersions(feed.version, current) > 0 ? { kind: 'newer', feed, target: updateTarget(feed, platform) } : { kind: 'current', feed };
}
