// Shared by the update server, the publisher (CI) and the tests. Plain Node, no dependencies.
// The protocol is Expo Updates v1 (https://github.com/expo/expo/blob/main/docs/pages/technical-specs/expo-updates-1.mdx).
import { createHash, createSign, createVerify, randomBytes } from 'node:crypto';

/* ------------------------------------------------------------------ names that end up in paths / URLs ------------------------------------------------------------------ */
export const isChannel = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(s);
export const isRuntimeVersion = (s) => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s);
/** 16 hex characters: the fingerprint of the native part of a build (see native-hash.mjs) */
export const isNativeHash = (s) => typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);
/** base64url of a SHA-256 */
export const isAssetHash = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
export const isPlatform = (s) => s === 'ios' || s === 'android';
export const isIsoDate = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);
export const isMime = (s) => typeof s === 'string' && s.length <= 100 && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(s);

/* ------------------------------------------------------------------ hashes ------------------------------------------------------------------ */
export const sha256b64u = (buf) => createHash('sha256').update(buf).digest('base64url');
export const md5hex = (buf) => createHash('md5').update(buf).digest('hex');

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  json: 'application/json', txt: 'text/plain', html: 'text/html', js: 'application/javascript',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', pdf: 'application/pdf',
};
export const mimeForExt = (ext) => MIME[String(ext ?? '').replace(/^\./, '').toLowerCase()] ?? 'application/octet-stream';

/* ------------------------------------------------------------------ the manifest of one platform ------------------------------------------------------------------ */
/**
 * @param {object} o
 * @param {string} o.id               uuid of the update
 * @param {string} o.createdAt        ISO date: the client takes the NEWEST one
 * @param {string} o.runtimeVersion
 * @param {{bundle: string, assets: {path: string, ext?: string}[]}} o.meta   one platform of `fileMetadata` in `expo export`'s metadata.json
 * @param {(relPath: string) => Buffer} o.readFile   reads a file of the export directory
 * @param {string} o.baseUrl          public address of the server, e.g. https://example.com
 * @param {object} [o.expoClient]     the app's public config (`expo config --json --type public`)
 * @returns {{ manifest: object, files: Map<string, {buffer: Buffer, contentType: string}> }}
 */
/** the note a person writes for an update: no control characters, no long blank runs, at most 400 letters (same rules as core/updater.ts) */
export function cleanReleaseNote(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!t) return null;
  const letters = Array.from(t);
  return letters.length > 400 ? `${letters.slice(0, 399).join('')}…` : t;
}

export function buildPlatformManifest(o) {
  const files = new Map();
  const asset = (relPath, ext, isLaunch) => {
    const buffer = o.readFile(relPath);
    const hash = sha256b64u(buffer);
    const contentType = isLaunch ? 'application/javascript' : mimeForExt(ext);
    files.set(hash, { buffer, contentType });
    return {
      hash,
      key: md5hex(buffer),
      ...(isLaunch || !ext ? {} : { fileExtension: `.${String(ext).replace(/^\./, '')}` }),
      contentType,
      url: `${o.baseUrl.replace(/\/+$/, '')}/ota/assets/${hash}`,
    };
  };
  if (!o.meta || typeof o.meta.bundle !== 'string' || !Array.isArray(o.meta.assets)) throw new Error('metadata.json の形式が想定と違います（bundle と assets が必要です）');
  const manifest = {
    id: o.id,
    createdAt: o.createdAt,
    runtimeVersion: o.runtimeVersion,
    assets: o.meta.assets.map((a) => asset(a.path, a.ext, false)),
    launchAsset: asset(o.meta.bundle, null, true),
    metadata: {},
    extra: { expoClient: o.expoClient ?? {}, ...(cleanReleaseNote(o.note) ? { releaseNote: cleanReleaseNote(o.note) } : {}) },
  };
  return { manifest, files };
}

export const buildRollbackDirective = (commitTime) => ({ type: 'rollBackToEmbedded', parameters: { commitTime } });

/* ------------------------------------------------------------------ signing (the server never sees the private key) ------------------------------------------------------------------ */
/** RSASSA-PKCS1-v1_5 with SHA-256 over the exact text that is sent */
export const signRsaSha256 = (text, privateKeyPem) => createSign('RSA-SHA256').update(text).sign(privateKeyPem, 'base64');
export const verifyRsaSha256 = (text, signatureB64, publicKeyPemOrObject) => {
  try {
    return createVerify('RSA-SHA256').update(text).verify(publicKeyPemOrObject, signatureB64, 'base64');
  } catch {
    return false;
  }
};
/** the `expo-signature` header: an Expo structured-field dictionary with quoted strings */
export const signatureHeader = (signatureB64, keyId = 'main') => `sig="${signatureB64}", keyid="${keyId}"`;
export function parseSignatureHeader(header) {
  if (typeof header !== 'string' || header.length > 4000) return null;
  const out = {};
  for (const m of header.matchAll(/([a-z]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return typeof out.sig === 'string' && out.sig.length > 0 ? out : null;
}

/* ------------------------------------------------------------------ multipart/mixed ------------------------------------------------------------------ */
export const newBoundary = () => `ota-${randomBytes(16).toString('hex')}`;

/** parts: [{ name, headers?: {k: v}, body: string }] */
export function multipartBody(parts, boundary) {
  const chunks = [];
  for (const p of parts) {
    chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n`);
    for (const [k, v] of Object.entries(p.headers ?? {})) chunks.push(`${k}: ${v}\r\n`);
    chunks.push(`\r\n${p.body}\r\n`);
  }
  chunks.push(`--${boundary}--\r\n`);
  return Buffer.from(chunks.join(''), 'utf8');
}

/** the reverse (for the tests, and for a client that wants to look): { name, headers (lower-case), body }[] */
export function parseMultipart(buffer, boundary) {
  const text = buffer.toString('utf8');
  const out = [];
  for (const raw of text.split(`--${boundary}`).slice(1)) {
    if (raw.startsWith('--')) break;
    const part = raw.replace(/^\r\n/, '');
    const cut = part.indexOf('\r\n\r\n');
    if (cut < 0) continue;
    const headers = {};
    for (const line of part.slice(0, cut).split('\r\n')) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const body = part.slice(cut + 4).replace(/\r\n$/, '');
    const name = /name="([^"]+)"/.exec(headers['content-disposition'] ?? '')?.[1] ?? '';
    out.push({ name, headers, body });
  }
  return out;
}

export const boundaryOf = (contentType) => /boundary=([^;\s]+)/.exec(contentType ?? '')?.[1] ?? null;
