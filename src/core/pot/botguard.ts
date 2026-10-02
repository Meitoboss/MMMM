import { base64ToBytes, bytesToBase64, utf8Decode } from '../lyrics/base64';

/**
 * Port of composeApp/.../webpotoken/JavaScriptUtil.kt (originally from NewPipe, GPL-3.0).
 * Pure functions that translate YouTube's BotGuard service responses.
 */

export interface ChallengeData {
  messageId: string;
  interpreterJavascript: {
    privateDoNotAccessOrElseSafeScriptWrappedValue: string | null;
    privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string | null;
  };
  interpreterHash: string;
  program: string;
  globalName: string;
  clientExperimentsStateBlob: string;
}

/** YouTube's base64 flavour: `-` `_` instead of `+` `/`, `.` as padding. */
export function ytBase64ToBytes(input: string): number[] {
  const std = input.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '=');
  return Array.from(base64ToBytes(std));
}

/** "Descramble": base64-decode, add 97 to each byte (mod 256), read as UTF-8. */
export function descramble(scrambled: string): string {
  return utf8Decode(ytBase64ToBytes(scrambled).map((b) => (b + 97) & 0xff));
}

export function parseChallengeData(raw: string): ChallengeData {
  const scrambled = JSON.parse(raw) as unknown[];
  const data: unknown[] =
    scrambled.length > 1 && typeof scrambled[1] === 'string'
      ? (JSON.parse(descramble(scrambled[1])) as unknown[])
      : (scrambled[1] as unknown[]);

  const firstString = (v: unknown): string | null =>
    Array.isArray(v) ? ((v.find((x) => typeof x === 'string') as string | undefined) ?? null) : null;

  return {
    messageId: String(data[0]),
    interpreterJavascript: {
      privateDoNotAccessOrElseSafeScriptWrappedValue: firstString(data[1]),
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: firstString(data[2]),
    },
    interpreterHash: String(data[3]),
    program: String(data[4]),
    globalName: String(data[5]),
    clientExperimentsStateBlob: String(data[7]),
  };
}

/** `[ "<base64 integrity token>", <seconds valid> ]` -> raw bytes + validity */
export function parseIntegrityTokenData(raw: string): { bytes: number[]; expiresInSec: number } {
  const arr = JSON.parse(raw) as [string, number | string];
  return { bytes: ytBase64ToBytes(arr[0]), expiresInSec: Number(arr[1]) };
}

/** `"97,98,99"` (Uint8Array.toString()) -> PO token in YouTube's url-safe base64 */
export function u8CsvToPoToken(csv: string): string {
  const bytes = csv.split(',').map((x) => Number(x) & 0xff);
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_');
}

/** `visitorData` as returned by YouTube is percent-encoded base64 of a protobuf; undo the percent-encoding. */
export function decodeVisitorData(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** The 11-character visitor id inside visitorData (protobuf field 1), as used by yt-dlp's `bind_to_visitor_id`. */
export function extractVisitorId(visitorData: string): string | undefined {
  try {
    const bytes = ytBase64ToBytes(decodeVisitorData(visitorData));
    if (bytes[0] !== 0x0a) return undefined;
    const len = bytes[1];
    if (!len || len > 64 || bytes.length < 2 + len) return undefined;
    const id = utf8Decode(bytes.slice(2, 2 + len));
    return /^[A-Za-z0-9_-]+$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
