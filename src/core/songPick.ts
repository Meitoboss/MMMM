/** Choosing which saved songs go into the file: the rules of the selection (the screen and the store only draw and keep it). */
export interface PickItem {
  id: string;
  title: string;
  artist: string;
  /** the size of the saved file */
  bytes: number;
}

export const selectAll = (items: PickItem[]): Set<string> => new Set(items.map((i) => i.id));

export function toggle(sel: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(sel);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** select (on) or deselect (off) the given songs – the ones the search shows, when a search is on */
export function setMany(sel: ReadonlySet<string>, ids: string[], on: boolean): Set<string> {
  const next = new Set(sel);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** how many of the songs are chosen, and how big they are together (a chosen id that is not in the list does not count) */
export function summary(items: PickItem[], sel: ReadonlySet<string>): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const i of items) {
    if (sel.has(i.id)) {
      count++;
      bytes += i.bytes;
    }
  }
  return { count, bytes };
}

/** a search over title and artist: every word has to be found (any case, any width of the letters) */
export function filterItems(items: PickItem[], query: string): PickItem[] {
  const words = query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((i) => {
    const hay = `${i.title} ${i.artist}`.normalize('NFKC').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** the ids that are chosen, in the order of the list (what is handed to the exporter) */
export const chosenIds = (items: PickItem[], sel: ReadonlySet<string>): string[] => items.filter((i) => sel.has(i.id)).map((i) => i.id);
