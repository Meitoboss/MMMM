import * as SQLite from 'expo-sqlite';
import type { Db, SqlValue } from './driver';
import { migrate } from './schema';

let instance: Promise<Db> | undefined;
let depth = 0;

/** Adapter around the async expo-sqlite API. */
export function openDb(name = 'rimusic.db'): Promise<Db> {
  instance ??= (async () => {
    const raw = await SQLite.openDatabaseAsync(name);
    const db: Db = {
      exec: (sql) => raw.execAsync(sql),
      run: async (sql, params: SqlValue[] = []) => {
        const r = await raw.runAsync(sql, params);
        return { lastInsertRowId: r.lastInsertRowId, changes: r.changes };
      },
      all: <T,>(sql: string, params: SqlValue[] = []) => raw.getAllAsync<T>(sql, params),
      first: <T,>(sql: string, params: SqlValue[] = []) => raw.getFirstAsync<T>(sql, params),
      // Nested calls (e.g. addToPlaylist -> upsertSong) join the outer transaction:
      // SQLite cannot BEGIN inside a transaction.
      transaction: async <T,>(fn: () => Promise<T>) => {
        if (depth > 0) return fn();
        depth++;
        try {
          let result!: T;
          await raw.withTransactionAsync(async () => {
            result = await fn();
          });
          return result;
        } finally {
          depth--;
        }
      },
    };
    await migrate(db);
    return db;
  })();
  return instance;
}
