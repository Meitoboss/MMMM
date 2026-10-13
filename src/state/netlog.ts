import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { type NetEntry, addEntry, sanitizeEntries } from '../core/netlog';
import { setRemoteObserver } from '../core/pot/remote';

/** The record of the token server's answers, kept on the phone between starts (the logic is core/netlog.ts). */
const KEY = 'netlog.v1';

function load(): NetEntry[] {
  try {
    return sanitizeEntries(JSON.parse(Storage.getItemSync(KEY) ?? '[]'));
  } catch {
    return [];
  }
}
function save(entries: NetEntry[]): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(entries));
  } catch {
    /* the record is only a help */
  }
}

export const useNetLog = create<{ entries: NetEntry[] }>(() => ({ entries: load() }));

/** from now on, every request to the token server is written down */
export function startNetLog(): () => void {
  setRemoteObserver((e) => {
    const entries = addEntry(useNetLog.getState().entries, e);
    useNetLog.setState({ entries });
    save(entries);
  });
  return () => setRemoteObserver(undefined);
}

export function clearNetLog(): void {
  useNetLog.setState({ entries: [] });
  save([]);
}
