import type { ByteSink, ByteSource } from './archive';
import type { ExportSong } from './songArchive';

/**
 * Saved songs as plain audio files, one per song ("Artist - Title.m4a") – for playing in another app, or on another device.
 * The audio is copied as it is (no conversion), so it is fast and the sound is exactly what was saved. It is NOT converted to mp3:
 * the songs are AAC (.m4a) or Opus (.webm), and making an mp3 means decoding and encoding again, which a phone cannot do here without
 * a converter program built into the app.
 */

/** the file extension for a saved song's type (null: unknown – the extension of the saved file is used) */
export function audioExtension(mimeType: string | null | undefined): string | null {
  const m = (mimeType ?? '').toLowerCase().split(';')[0].trim();
  switch (m) {
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
    case 'audio/aac':
      return 'm4a';
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
    case 'application/ogg':
      return 'ogg';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    default:
      return null;
  }
}

/** the type to hand to the phone's file system for the new file */
export function audioMime(extension: string): string {
  switch (extension) {
    case 'm4a':
      return 'audio/mp4';
    case 'webm':
      return 'audio/webm';
    case 'ogg':
      return 'audio/ogg';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}

const MAX_NAME_LETTERS = 90;

/** a name that every file system accepts: no slashes, colons or other forbidden marks, no control characters, not too long, never empty */
export function cleanFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let s = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, ''); // no leading dots (hidden), no trailing dot or space (Windows)
  const letters = Array.from(s);
  if (letters.length > MAX_NAME_LETTERS) s = letters.slice(0, MAX_NAME_LETTERS).join('').trim();
  return s || 'song';
}

/** "Artist - Title" without an extension; the artist is left out when it is not known */
export function audioBaseName(song: { title: string; artists?: { name: string }[] }): string {
  const artist = (song.artists ?? []).map((a) => a.name).filter(Boolean).join(', ');
  const title = song.title.replace(/^e:/, '');
  return cleanFileName(artist ? `${artist} - ${title}` : title);
}

/** the extension to use: from the type, else from the saved file's own name, else "m4a" (what an iPhone saves) */
export function extensionFor(song: ExportSong): string {
  const fromMime = audioExtension(song.mimeType);
  if (fromMime) return fromMime;
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(song.fileName);
  return m ? m[1].toLowerCase() : 'm4a';
}

/** one name for each song, none twice (the same artist and title on two songs: "… (2)", "… (3)"); case does not tell names apart */
export function planNames(songs: ExportSong[]): { song: ExportSong; name: string; mime: string }[] {
  const taken = new Set<string>();
  return songs.map((song) => {
    const ext = extensionFor(song);
    const base = audioBaseName(song.song);
    let name = `${base}.${ext}`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).${ext}`;
    taken.add(name.toLowerCase());
    return { song, name, mime: audioMime(ext) };
  });
}

/* ------------------------------------------------------------------ the copying ------------------------------------------------------------------ */
export const AUDIO_CHUNK = 1024 * 1024;

export interface AudioOutput {
  sink: ByteSink;
  /** the file is complete: make it visible */
  commit(): Promise<void>;
  /** leave nothing of this file behind */
  abort(): Promise<void>;
}

export interface AudioExportDeps {
  songs: ExportSong[];
  /** the size of a saved file now, or null when it is gone */
  fileSize(fileName: string): Promise<number | null>;
  openFile(fileName: string): Promise<{ source: ByteSource; close(): void | Promise<void> }>;
  begin(name: string, mime: string): Promise<AudioOutput>;
  onProgress?(p: { done: number; total: number; bytesDone: number; bytesTotal: number; title: string }): void;
  isCancelled?: () => boolean;
}

export interface AudioExportResult {
  written: { id: string; title: string; name: string; bytes: number }[];
  /** saved songs whose file was gone */
  skipped: { id: string; title: string }[];
  bytes: number;
  /** stopped by the person: what was finished stays; the file that was being written is gone */
  cancelled: boolean;
}

export async function exportAudioFiles(deps: AudioExportDeps): Promise<AudioExportResult> {
  const result: AudioExportResult = { written: [], skipped: [], bytes: 0, cancelled: false };
  const plan = planNames(deps.songs);
  const sizes = new Map<string, number>();
  for (const p of plan) {
    const size = await deps.fileSize(p.song.fileName);
    if (size === null || size < 1) result.skipped.push({ id: p.song.song.id, title: p.song.song.title });
    else sizes.set(p.song.song.id, size);
  }
  const todo = plan.filter((p) => sizes.has(p.song.song.id));
  const bytesTotal = [...sizes.values()].reduce((a, b) => a + b, 0);
  let bytesDone = 0;
  let done = 0;
  for (const p of todo) {
    const title = p.song.song.title;
    deps.onProgress?.({ done, total: todo.length, bytesDone, bytesTotal, title });
    if (deps.isCancelled?.()) {
      result.cancelled = true;
      break;
    }
    const size = sizes.get(p.song.song.id) as number;
    const input = await deps.openFile(p.song.fileName);
    const out = await deps.begin(p.name, p.mime);
    let copied = 0;
    try {
      for (;;) {
        if (deps.isCancelled?.()) {
          result.cancelled = true;
          break;
        }
        const piece = await input.source.read(AUDIO_CHUNK);
        if (piece.length === 0) break;
        await out.sink.write(piece);
        copied += piece.length;
        bytesDone += piece.length;
        deps.onProgress?.({ done, total: todo.length, bytesDone, bytesTotal, title });
      }
      if (result.cancelled) {
        bytesDone -= copied;
        await out.abort();
        break;
      }
      if (copied !== size) throw new Error('書き込み中に、元のファイルの大きさが変わりました'); // the file changed while it was copied
      await out.commit();
    } catch (e) {
      await out.abort().catch(() => undefined); // a half file would look like a song
      throw e;
    } finally {
      await input.close();
    }
    done++;
    result.written.push({ id: p.song.song.id, title, name: p.name, bytes: copied });
    result.bytes += copied;
  }
  deps.onProgress?.({ done, total: todo.length, bytesDone, bytesTotal, title: '' });
  return result;
}
