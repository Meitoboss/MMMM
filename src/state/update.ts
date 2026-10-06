import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { APP_VERSION } from '../appVersion';
import { fetchJson } from '../core/streams/util';
import { type UpdateResult, checkForUpdate } from '../core/updateCheck';
import { useSettings } from './settings';

const KEY = 'update.dismissed.v1';

interface UpdateState {
  result: UpdateResult | null;
  checking: boolean;
  /** the version whose notice was closed with "あとで" – it does not come back, only a newer one does */
  dismissed: string;
  check: (manual?: boolean) => Promise<void>;
  dismiss: () => void;
}

function readDismissed(): string {
  try {
    return Storage.getItemSync(KEY) ?? '';
  } catch {
    return '';
  }
}

export const useUpdate = create<UpdateState>((set, get) => ({
  result: null,
  checking: false,
  dismissed: readDismissed(),
  check: async (manual = false) => {
    const url = useSettings.getState().updateFeedUrl.trim();
    if (!url) {
      if (manual) set({ result: { kind: 'error', message: '更新情報のURLが入っていません' } });
      return;
    }
    if (get().checking) return;
    set({ checking: true });
    const result = await checkForUpdate(url, APP_VERSION, Platform.OS === 'android' ? 'android' : 'ios', (u) => fetchJson<unknown>(u, { headers: { 'Cache-Control': 'no-cache' } }, 8000));
    set({ result, checking: false });
  },
  dismiss: () => {
    const r = get().result;
    if (r?.kind !== 'newer') return;
    try {
      Storage.setItemSync(KEY, r.feed.version);
    } catch {
      /* the notice just comes back next time */
    }
    set({ dismissed: r.feed.version });
  },
}));
