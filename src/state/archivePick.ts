import { create } from 'zustand';

import { type PickState, PickSession } from '../core/pickSession';
import type { PickItem } from '../core/songPick';

/** The screen that chooses the songs for the file draws this; the rules are in core/pickSession.ts. */
const session: PickSession = new PickSession((s) => useArchivePick.setState(s));
export const useArchivePick = create<PickState>(() => session.state);

export const archivePick = {
  toggle: (id: string) => session.toggle(id),
  setMany: (ids: string[], on: boolean) => session.setMany(ids, on),
  confirm: () => session.confirm(),
  cancel: () => session.cancel(),
};

/** Shows the screen and waits for the answer. `open` shows the screen (a navigation); it is called after the list is ready. */
export function pickSongs(items: PickItem[], open: () => void): Promise<string[] | null> {
  const answer = session.begin(items);
  open();
  return answer;
}
