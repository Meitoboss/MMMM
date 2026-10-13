import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { type SortKey, type SortPrefs, type SortTab, parseSortPrefs, withSort } from '../core/librarySort';

/** The order chosen for each list of the Library, kept between starts. */
const KEY = 'library.sort.v1';

function load(): SortPrefs {
  try {
    return parseSortPrefs(JSON.parse(Storage.getItemSync(KEY) ?? '{}'));
  } catch {
    return {};
  }
}

export const useLibrarySort = create<{ prefs: SortPrefs; set: (tab: SortTab, key: SortKey) => void }>((set, get) => ({
  prefs: load(),
  set: (tab, key) => {
    const prefs = withSort(get().prefs, tab, key);
    set({ prefs });
    try {
      Storage.setItemSync(KEY, JSON.stringify(prefs));
    } catch {
      /* the choice is used for now; it is just not remembered */
    }
  },
}));
