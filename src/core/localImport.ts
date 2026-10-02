import { LOCAL_PREFIX, fileExtension, makeLocalId, parseLocalName } from './localMeta';
import type { SongItem } from './types';
import type { Db } from '../db/driver';
import * as repo from '../db/repo';

/**
 * Importing music the user put into the app's folder (Files app → On My iPhone → Music space → Music).
 * The file-system part is injected, so this logic can be tested without a phone.
 */
export interface InboxFile {
  uri: string;
  /** decoded file name, e.g. "Artist - Title.mp3" */
  name: string;
}

export interface ImportDeps {
  list(): Promise<InboxFile[]>;
  /** moves the file into the app's own storage under `storedName` */
  move(fromUri: string, storedName: string): Promise<void>;
  /** gives the file back its place if the database could not take it */
  undo(storedName: string, originalUri: string): Promise<void>;
  size(uri: string): Promise<number | undefined>;
  /** Android: files stay where they are, so skip the ones that were imported before */
  alreadyImported?(file: InboxFile): Promise<boolean>;
  markImported?(file: InboxFile): Promise<void>;
}

export interface ImportResult {
  added: SongItem[];
  failed: string[];
  /** how many NEW music files were waiting in the folder */
  found: number;
}

export async function runImport(db: Db, deps: ImportDeps): Promise<ImportResult> {
  const all = await deps.list();
  const files: InboxFile[] = [];
  for (const f of all) if (!(await deps.alreadyImported?.(f))) files.push(f);
  const added: SongItem[] = [];
  const failed: string[] = [];
  for (const f of files) {
    const id = makeLocalId();
    // ASCII-only stored name: Japanese file names would need URL-encoding for the player. The title lives in the database.
    const stored = `${id.slice(LOCAL_PREFIX.length)}${fileExtension(f.name)}`;
    let moved = false;
    try {
      const size = await deps.size(f.uri);
      await deps.move(f.uri, stored);
      moved = true;
      const meta = parseLocalName(f.name);
      added.push(await repo.addLocalFile(db, { id, fileName: stored, title: meta.title, artist: meta.artist, size }));
      await deps.markImported?.(f);
    } catch {
      failed.push(f.name);
      if (moved) await deps.undo(stored, f.uri).catch(() => undefined);
    }
  }
  return { added, failed, found: files.length };
}
