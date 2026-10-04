import type { MusicItem, SearchFilter } from './types';

/** Search results for "すべて": one block per kind – songs with songs, videos with videos, albums with albums … */
export interface Group {
  kind: MusicItem['kind'];
  label: string;
  /** the filter that shows only this kind (for "see all") */
  filter: SearchFilter;
  items: MusicItem[];
}

const ORDER: { kind: MusicItem['kind']; label: string; filter: SearchFilter }[] = [
  { kind: 'song', label: '曲', filter: 'song' },
  { kind: 'video', label: 'ビデオ', filter: 'video' },
  { kind: 'album', label: 'アルバム', filter: 'album' },
  { kind: 'artist', label: 'アーティスト', filter: 'artist' },
  { kind: 'playlist', label: 'プレイリスト', filter: 'community_playlist' },
];

/** non-empty groups, in a fixed order; the order inside a group is kept */
export function groupResults(items: MusicItem[]): Group[] {
  return ORDER.map((o) => ({ ...o, items: items.filter((i) => i.kind === o.kind) })).filter((g) => g.items.length > 0);
}

export type Row = { type: 'header'; group: Group } | { type: 'item'; item: MusicItem };

/** a flat list (header, items, header, items …) for a FlatList */
export function toRows(groups: Group[]): Row[] {
  return groups.flatMap((g): Row[] => [{ type: 'header', group: g }, ...g.items.map((item): Row => ({ type: 'item', item }))]);
}
