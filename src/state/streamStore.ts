import Storage from 'expo-sqlite/kv-store';

import { setStreamStore } from '../core/streams/resolver';

/** keeps the stream addresses on the phone between starts (they are checked for their expiry when used) */
const KEY = 'streams.urls.v1';

export function startStreamStore(): void {
  setStreamStore({
    load() {
      try {
        return JSON.parse(Storage.getItemSync(KEY) ?? '{}');
      } catch {
        return {};
      }
    },
    save(entries) {
      try {
        Storage.setItemSync(KEY, JSON.stringify(entries));
      } catch {
        /* best effort */
      }
    },
  });
}
