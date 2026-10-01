/** Minimal async SQL interface – implemented by expo-sqlite in the app and node:sqlite in tests. */
export type SqlValue = string | number | null;

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ lastInsertRowId: number; changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
