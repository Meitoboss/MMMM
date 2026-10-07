import { APP_VERSION } from '../appVersion';
import { type BackupFile, type BackupSummary, type BackupTheme, backupFileName, parseBackup, pickSettings, summarizeBackup } from '../core/backup';
import { type ImportReport, exportLibrary, importLibrary, previewImport } from '../db/backup';
import { openDb } from '../db/expo';
import { type BackupEntry, listBackupFiles, readBackupFile, saveBackupFile } from '../player/backupFiles';
import { type Palette, palettes, useTheme } from '../ui/theme';
import { useLikes } from './likes';
import { useSettings } from './settings';

const strings = (o: Partial<Palette> | undefined): Record<string, string> => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;

/** the colours and look as they are now */
function currentTheme(): BackupTheme {
  const t = useTheme.getState();
  return { mode: t.mode, overrides: { dark: strings(t.overrides.dark), light: strings(t.overrides.light) } };
}

export interface MadeBackup {
  name: string;
  uri: string;
  shareable: boolean;
  summary: BackupSummary;
}

/** writes the library (and, if wanted, the preferences) into a new backup file */
export async function makeBackup(opts: { events: boolean; withSettings: boolean }): Promise<MadeBackup> {
  const db = await openDb();
  const file = await exportLibrary(db, { events: opts.events, appVersion: APP_VERSION });
  if (opts.withSettings) {
    file.settings = pickSettings(useSettings.getState() as unknown as Record<string, unknown>);
    file.theme = currentTheme();
  }
  const name = backupFileName(new Date());
  const saved = await saveBackupFile(name, JSON.stringify(file));
  return { name, uri: saved.uri, shareable: saved.shareable, summary: summarizeBackup(file) };
}

export { listBackupFiles };

export type OpenedBackup = { ok: true; entry: BackupEntry; backup: BackupFile; warnings: string[]; summary: BackupSummary; preview: ImportReport } | { ok: false; error: string };

/** reads and checks a file, and works out what restoring it would do (without doing it) */
export async function openBackup(entry: BackupEntry): Promise<OpenedBackup> {
  let text: string;
  try {
    text = await readBackupFile(entry.uri);
  } catch (e) {
    return { ok: false, error: `ファイルを読めませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    const preview = await previewImport(await openDb(), parsed.backup);
    return { ok: true, entry, backup: parsed.backup, warnings: parsed.warnings, summary: summarizeBackup(parsed.backup), preview };
  } catch (e) {
    return { ok: false, error: `中身を確認できませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/** adds the backup to the library – all or nothing */
export async function restoreBackup(backup: BackupFile): Promise<ImportReport> {
  const report = await importLibrary(await openDb(), backup);
  useLikes.setState((s) => ({ version: s.version + 1 })); // hearts everywhere look again
  return report;
}

/** the preferences and colours of a backup replace the current ones; returns how many settings were applied */
export function applyBackupPreferences(backup: BackupFile): { settings: number; theme: boolean } {
  const picked = backup.settings ? pickSettings(backup.settings) : {};
  if (Object.keys(picked).length) useSettings.getState().update(picked);
  let theme = false;
  if (backup.theme) {
    const t = useTheme.getState();
    if (backup.theme.mode) t.setMode(backup.theme.mode);
    for (const scheme of ['dark', 'light'] as const) {
      const colours = backup.theme.overrides?.[scheme];
      if (!colours) continue;
      t.resetColors(scheme);
      for (const [key, value] of Object.entries(colours)) if (key in palettes[scheme]) useTheme.getState().setColor(scheme, key as keyof Palette, value);
    }
    theme = true;
  }
  return { settings: Object.keys(picked).length, theme };
}
