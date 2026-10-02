/** Pure helpers for the drag-to-reorder list. */

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, it);
  return next;
}

/** Row index a dragged row is over, given where it started and how far (dy, px) it was dragged. */
export function targetIndex(startIndex: number, dy: number, rowHeight: number, count: number): number {
  if (count <= 0) return 0;
  const raw = Math.round((startIndex * rowHeight + dy) / rowHeight);
  return Math.max(0, Math.min(count - 1, raw));
}
