/**
 * The sine tone that plays under the 集中 sounds. Pure logic (no device here), so it can be tested.
 *
 * The tone is a short loop of exactly `TONE_SECONDS`. Its frequency is nudged so that the loop holds a whole number of cycles:
 * then the end of the loop joins the start in the same phase, and the loop does not click.
 */
export const TONE_SECONDS = 10;
export const TONE_RATE = 44_100;
/** the tone's height in the file (the loudness on the phone is set separately) */
const AMPLITUDE = 0.8;
export const TONE_MIN_HZ = 20;
export const TONE_MAX_HZ = 2000;
export const TONE_DEFAULT_HZ = 432;

/** the frequency that is actually played: the request, clamped to the range, with a whole number of cycles in the loop */
export function toneHz(requested: number): number {
  const hz = Math.min(TONE_MAX_HZ, Math.max(TONE_MIN_HZ, Number.isFinite(requested) ? requested : TONE_DEFAULT_HZ));
  return Math.round(hz * TONE_SECONDS) / TONE_SECONDS;
}

/** one loop of the tone as 16-bit samples (mono) */
export function toneSamples(hz: number): Int16Array {
  const n = TONE_SECONDS * TONE_RATE;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / TONE_RATE) * AMPLITUDE * 32767);
  }
  return out;
}

/** a WAV file (mono, 16-bit PCM) holding the samples */
export function wavBytes(samples: Int16Array, rate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true); // size of the format block
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // bytes per second
  v.setUint16(32, 2, true); // bytes per frame
  v.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) v.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buf);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 text of some bytes (the file system takes base64 when writing) */
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}
