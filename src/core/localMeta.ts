/** Helpers for songs that come from files on the device (not from YouTube). */

export const LOCAL_PREFIX = 'local:';
export const LOCAL_ARTIST = 'ローカルファイル';

export const isLocalId = (id: string): boolean => id.startsWith(LOCAL_PREFIX);

/** New unique id, e.g. "local:lq3k9x2a7f4c" (time + random, no characters that are awkward in file names) */
export function makeLocalId(now = Date.now(), rand = Math.random): string {
  const r = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0');
  return `${LOCAL_PREFIX}${now.toString(36)}${r}`;
}

/** ".mp3" from "Song.MP3"; falls back to ".m4a" when the name has no usable extension */
export function fileExtension(name: string, fallback = '.m4a'): string {
  const m = name.match(/(\.[A-Za-z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * Title / artist from a file name: "Artist - Title.mp3" → both; "01 Title.m4a" → title without the track number.
 * (Reading ID3 tags would need a native module; the file name is what every file has.)
 */
export function parseLocalName(fileName: string): { title: string; artist?: string } {
  const base = fileName
    .replace(/\.[A-Za-z0-9]{2,5}$/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const both = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (both) {
    const title = both[2].replace(/^\d{1,3}[.\-\s]+(?=\S)/, '').trim();
    return { artist: both[1].trim(), title: title || both[2].trim() };
  }
  const title = base.replace(/^\d{1,3}[.\-\s]+(?=\S)/, '').trim();
  return { title: title || base || fileName };
}

/** Formats AVPlayer (the iPhone's own player) can play. */
export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.aif', '.aiff', '.caf', '.mp4'];

export function isAudioFileName(name: string): boolean {
  if (name.startsWith('.')) return false; // hidden / system files such as ".DS_Store"
  const ext = fileExtension(name, '');
  return ext !== '' && AUDIO_EXTENSIONS.includes(ext);
}
