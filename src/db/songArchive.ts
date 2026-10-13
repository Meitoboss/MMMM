import { APP_VERSION } from '../appVersion';
import { parseBackup } from '../core/backup';
import type { ExportSong, SongMeta } from '../core/songArchive';
import { songFromMeta } from '../core/songArchive';
import { exportLibrary, importLibrary } from './backup';
import type { Db } from './driver';
import * as repo from './repo';

/** the saved songs, with what is needed to put them into an archive (newest first) */
export async function listExportSongs(db: Db): Promise<ExportSong[]> {
  const out: ExportSong[] = [];
  for (const song of await repo.offlineSongs(db)) {
    const file = await repo.offlineFile(db, song.id);
    if (!file) continue;
    out.push({ song, fileName: file.fileName, mimeType: file.mimeType ?? null, loudnessDb: await repo.loudnessFor(db, song.id) });
  }
  return out;
}

/** the library as the JSON text of a backup file (without the play history: it can be large and the songs do not need it) */
export async function libraryAsJson(db: Db): Promise<string> {
  return JSON.stringify(await exportLibrary(db, { events: false, appVersion: APP_VERSION }));
}

/** puts a library backup (text) into the library; throws with a reason when it is not a usable backup */
export async function applyLibraryJson(db: Db, text: string): Promise<void> {
  const parsed = parseBackup(text);
  if (!parsed.ok) throw new Error(parsed.error);
  await importLibrary(db, parsed.backup);
}

/** records a restored song: the song, its saved file, and its loudness (so that the volume matches as before) */
export async function saveRestoredSong(db: Db, meta: SongMeta, file: { fileName: string; size: number }): Promise<void> {
  const song = songFromMeta(meta);
  await db.transaction(async () => {
    await repo.addOffline(db, song, { fileName: file.fileName, size: file.size, mimeType: meta.mimeType ?? undefined });
    if (meta.loudnessDb !== null) await repo.saveFormat(db, song, { mimeType: meta.mimeType ?? undefined, loudnessDb: meta.loudnessDb });
  });
}

/** is the song already saved: a database row (the caller also checks that the file is there) */
export async function hasOfflineRow(db: Db, id: string): Promise<boolean> {
  return (await repo.offlineFile(db, id)) !== null;
}
