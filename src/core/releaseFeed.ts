/**
 * The two small files a release publishes next to the IPA / APK:
 *  - version.json: what the app reads to say "a new version is out" (see updateCheck.ts – the same shape)
 *  - altstore.json: an AltStore "source", so that AltStore on an iPhone lists the app and offers each new version
 * Made from app.json, so the version can never differ from the app's own.
 */
export const IPA_NAME = 'MusicSpace-unsigned.ipa';
export const APK_NAME = 'MusicSpace-android.apk';

export interface AppJson {
  expo: {
    name: string;
    version: string;
    description?: string;
    ios?: { bundleIdentifier?: string; buildNumber?: string };
    android?: { versionCode?: number };
  };
}

export interface Urls {
  ipa: string;
  apk: string;
  altstore: string;
  version: string;
  icon: string;
  page: string;
}

/**
 * `base`: your own server (e.g. https://example.com/musicspace) – for a private repository, whose release files cannot be
 * downloaded without logging in. Otherwise the files of the GitHub release are used (the repository must be public).
 */
export function releaseUrls(o: { repo: string; tag: string; base?: string }): Urls {
  if (o.base) {
    const b = o.base.replace(/\/+$/, '');
    return { ipa: `${b}/${IPA_NAME}`, apk: `${b}/${APK_NAME}`, altstore: `${b}/altstore.json`, version: `${b}/version.json`, icon: `${b}/icon.png`, page: b };
  }
  const rel = `https://github.com/${o.repo}/releases`;
  return {
    ipa: `${rel}/download/${o.tag}/${IPA_NAME}`,
    apk: `${rel}/download/${o.tag}/${APK_NAME}`,
    // these two always point at the newest release, so they can be given to AltStore / the app once
    altstore: `${rel}/latest/download/altstore.json`,
    version: `${rel}/latest/download/version.json`,
    icon: `https://raw.githubusercontent.com/${o.repo}/HEAD/assets/icon.png`,
    page: `${rel}/tag/${o.tag}`,
  };
}

export function buildFeeds(o: { app: AppJson; repo: string; tag: string; base?: string; ipaSize?: number; notes?: string; date?: string }) {
  const { expo } = o.app;
  const urls = releaseUrls(o);
  const build = String(expo.ios?.buildNumber ?? expo.android?.versionCode ?? '1');
  const date = o.date ?? new Date().toISOString().slice(0, 10);
  const notes = (o.notes ?? '').trim().slice(0, 300);

  /** the shape updateCheck.parseFeed reads */
  const feed = {
    version: expo.version,
    build,
    date,
    notes,
    ios: { url: urls.ipa, altstoreSource: urls.altstore },
    android: { url: urls.apk },
    page: urls.page,
  };

  const altstore = {
    name: expo.name,
    identifier: 'app.musicspace.source',
    sourceURL: urls.altstore,
    subtitle: '音楽プレイヤー',
    apps: [
      {
        name: expo.name,
        bundleIdentifier: expo.ios?.bundleIdentifier ?? '',
        developerName: expo.name,
        subtitle: '音楽プレイヤー',
        localizedDescription: expo.description ?? 'YouTube Music の曲を聴ける音楽プレイヤー',
        iconURL: urls.icon,
        tintColor: '82E653',
        category: 'entertainment',
        versions: [{ version: expo.version, buildVersion: build, date, localizedDescription: notes, downloadURL: urls.ipa, ...(o.ipaSize ? { size: o.ipaSize } : {}), minOSVersion: '15.1' }],
        // the older AltStore source format keeps these on the app itself
        version: expo.version,
        versionDate: date,
        versionDescription: notes,
        downloadURL: urls.ipa,
        ...(o.ipaSize ? { size: o.ipaSize } : {}),
      },
    ],
    news: [],
  };
  return { feed, altstore };
}
