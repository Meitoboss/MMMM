import { type PickItem, chosenIds, selectAll, setMany, toggle } from './songPick';

/**
 * The choice of songs for the file, between Settings (which waits for the answer) and the screen that shows the list.
 * `begin` returns a promise: the chosen ids when the person presses "決定", null when the screen is left any other way.
 */
export interface PickState {
  active: boolean;
  items: PickItem[];
  selected: Set<string>;
}

export class PickSession {
  state: PickState = { active: false, items: [], selected: new Set() };
  private settle: ((ids: string[] | null) => void) | null = null;

  constructor(private onChange: (s: PickState) => void = () => undefined) {}

  private set(patch: Partial<PickState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  begin(items: PickItem[]): Promise<string[] | null> {
    this.settle?.(null); // a choice that was still open is given up
    return new Promise((resolve) => {
      this.settle = resolve;
      this.set({ active: true, items, selected: selectAll(items) });
    });
  }

  toggle(id: string): void {
    this.set({ selected: toggle(this.state.selected, id) });
  }

  setMany(ids: string[], on: boolean): void {
    this.set({ selected: setMany(this.state.selected, ids, on) });
  }

  confirm(): void {
    const done = this.settle;
    this.settle = null;
    const ids = chosenIds(this.state.items, this.state.selected);
    this.set({ active: false });
    done?.(ids);
  }

  cancel(): void {
    const done = this.settle;
    this.settle = null;
    this.set({ active: false });
    done?.(null);
  }
}
