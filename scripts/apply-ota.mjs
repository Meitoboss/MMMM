// Sets the "over-the-air update" part of app.json for one build, just before the native project is generated.
//   node scripts/apply-ota.mjs --variant prod|trial
// - trial: a separate app next to the real one (own id and name) that takes updates from the "trial" channel
// - prod:  the real app; updates stay OFF until "prod" is listed under "enabledFor" in ota/config.json
// The fingerprint of the native part is written into the app (sent with every update request), so an update only
// ever reaches an app it fits.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { computeNativeHash } from '../ota/native-hash.mjs';

export const CERTIFICATE = 'ota/certificate.pem';
export const channelOf = (variant) => (variant === 'trial' ? 'trial' : 'main');

/** pure: the new app.json for a variant */
export function applyOtaToApp({ app, config, variant, nativeHash, certificateExists }) {
  if (variant !== 'prod' && variant !== 'trial') throw new Error(`variant は prod か trial です（${variant}）`);
  const next = JSON.parse(JSON.stringify(app));
  const e = next.expo;
  if (variant === 'trial') {
    e.name = `${e.name} β`;
    e.slug = `${e.slug}-trial`;
    if (e.ios?.bundleIdentifier) e.ios.bundleIdentifier = `${e.ios.bundleIdentifier}.trial`;
    if (e.android?.package) e.android.package = `${e.android.package}.trial`;
  }
  const channel = channelOf(variant);
  e.extra = { ...(e.extra ?? {}), otaChannel: channel, otaEnabled: false };
  if (!config.enabledFor.includes(variant)) {
    e.updates = { enabled: false };
    delete e.runtimeVersion;
    return next;
  }
  if (!certificateExists) throw new Error(`${CERTIFICATE} がありません。署名の証明書を、リポジトリに置いてください（ota/README.md の手順 2）`);
  if (!/^[0-9a-f]{16}$/.test(nativeHash)) throw new Error('nativeHash が正しくありません');
  e.runtimeVersion = config.runtimeVersion;
  e.extra.otaEnabled = true;
  e.updates = {
    enabled: true,
    url: `${config.serverBase.replace(/\/+$/, '')}/ota/${channel}/manifest`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    codeSigningCertificate: `./${CERTIFICATE}`,
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
    requestHeaders: { 'x-native-hash': nativeHash },
  };
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--variant');
  const variant = i >= 0 ? process.argv[i + 1] : 'prod';
  const config = JSON.parse(readFileSync('ota/config.json', 'utf8'));
  try {
    const app = JSON.parse(readFileSync('app.json', 'utf8'));
    const enabled = config.enabledFor.includes(variant);
    const next = applyOtaToApp({ app, config, variant, nativeHash: enabled ? computeNativeHash({ root: '.' }) : '0000000000000000', certificateExists: existsSync(path.resolve(CERTIFICATE)) });
    writeFileSync('app.json', `${JSON.stringify(next, null, 2)}\n`);
    console.log(`variant=${variant} updates=${next.expo.updates.enabled ? `ON ${next.expo.updates.url} native=${next.expo.updates.requestHeaders['x-native-hash']}` : 'OFF'}`);
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  }
}
