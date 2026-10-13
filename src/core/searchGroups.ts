import type { MusicItem, SearchFilter } from './types';

/** Search results for "すべて": one block per kind – songs with songs, videos with videos, albums with albums … */
export interface Group {
  kind: MusicItem['kind'];
  label: string;
  /** the filter that shows only this kind (for "see all") */
  filter: SearchFilter;
  items: MusicItem[];
}

/** the artists come first: the artist that was searched for is usually what is wanted, and it should not be buried under songs */
const ORDER: { kind: MusicItem['kind']; label: string; filter: SearchFilter; /** at most this many are shown (the heading's "すべて見る" shows the rest) */ limit?: number }[] = [
  { kind: 'artist', label: 'アーティスト', filter: 'artist', limit: 3 },
  { kind: 'song', label: '曲', filter: 'song' },
  { kind: 'video', label: 'ビデオ', filter: 'video' },
  { kind: 'album', label: 'アルバム', filter: 'album' },
  { kind: 'playlist', label: 'プレイリスト', filter: 'community_playlist' },
];

/** non-empty groups, in a fixed order; the order inside a group is kept */
export function groupResults(items: MusicItem[]): Group[] {
  return ORDER.map(({ limit, ...o }) => {
    const all = items.filter((i) => i.kind === o.kind);
    return { ...o, items: limit ? all.slice(0, limit) : all };
  }).filter((g) => g.items.length > 0);
}

export type Row = { type: 'header'; group: Group } | { type: 'item'; item: MusicItem };

/** a flat list (header, items, header, items …) for a FlatList */
export function toRows(groups: Group[]): Row[] {
  return groups.flatMap((g): Row[] => [{ type: 'header', group: g }, ...g.items.map((item): Row => ({ type: 'item', item }))]);
}
