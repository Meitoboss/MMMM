/**
 * How the lists of the Library are ordered: new → old, old → new, by name, and by the release (the year of the song's album).
 * What "new" means depends on the list: the day a song was saved offline, liked, imported, last played, or first came into the Library.
 */
export type SortTab = 'songs' | 'local' | 'offline' | 'liked' | 'tags' | 'history';
export type SortKey = 'title' | 'newest' | 'oldest' | 'releaseNewest' | 'releaseOldest';

export const SORT_LABEL: Record<SortKey, string> = {
  newest: '新しい順',
  oldest: '古い順',
  title: '名前順',
  releaseNewest: 'リリース 新しい順',
  releaseOldest: 'リリース 古い順',
};

/** the day that "new" and "old" are counted from, in each list */
export const DATE_MEANING: Record<SortTab, string> = {
  songs: 'ライブラリに入った日',
  local: '取り込んだ日',
  offline: '保存した日',
  liked: 'お気に入りにした日',
  tags: 'ライブラリに入った日',
  history: '最後に再生した日',
};

export const isRelease = (k: SortKey): boolean => k === 'releaseNewest' || k === 'releaseOldest';

/** the choices of a list, in the order they are shown (songs from the phone's own files have no album year) */
export function sortOptions(tab: SortTab): SortKey[] {
  return tab === 'local' ? ['newest', 'oldest', 'title'] : ['newest', 'oldest', 'title', 'releaseNewest', 'releaseOldest'];
}

/**
 * What a list shows before a choice is made. Saved songs: the newest at the BOTTOM (the way a list grows); the names lists stay A → Z;
 * everything else shows the newest first.
 */
export function defaultSort(tab: SortTab): SortKey {
  switch (tab) {
    case 'offline':
      return 'oldest';
    case 'songs':
    case 'tags':
      return 'title';
    default:
      return 'newest';
  }
}

export const validSort = (tab: SortTab, v: unknown): SortKey => (typeof v === 'string' && (sortOptions(tab) as string[]).includes(v) ? (v as SortKey) : defaultSort(tab));

export type SortPrefs = Partial<Record<SortTab, SortKey>>;
const TABS: SortTab[] = ['songs', 'local', 'offline', 'liked', 'tags', 'history'];

/** what is read back from storage: only a choice that exists for its list is kept */
export function parseSortPrefs(raw: unknown): SortPrefs {
  const out: SortPrefs = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const tab of TABS) {
    const v = (raw as Record<string, unknown>)[tab];
    if (typeof v === 'string' && (sortOptions(tab) as string[]).includes(v)) out[tab] = v as SortKey;
  }
  return out;
}

export const sortFor = (prefs: SortPrefs, tab: SortTab): SortKey => validSort(tab, prefs[tab]);
export const withSort = (prefs: SortPrefs, tab: SortTab, key: SortKey): SortPrefs => ({ ...prefs, [tab]: validSort(tab, key) });

/** one line under the choices: which day the order follows */
export function sortCaption(tab: SortTab, key: SortKey): string {
  switch (key) {
    case 'newest':
      return tab === 'offline' ? `${DATE_MEANING[tab]}が新しい曲が、上に並びます` : `${DATE_MEANING[tab]}の新しい順です`;
    case 'oldest':
      return tab === 'offline' ? `${DATE_MEANING[tab]}が新しい曲が、下に並びます` : `${DATE_MEANING[tab]}の古い順です`;
    case 'title':
      return '曲名の順です';
    case 'releaseNewest':
      return 'アルバムの発売年の、新しい順です（年が分からない曲は、最後）';
    case 'releaseOldest':
      return 'アルバムの発売年の、古い順です（年が分からない曲は、最後）';
  }
}
