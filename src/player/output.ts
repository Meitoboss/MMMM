import { native, onOutputChange } from '../../modules/binaural-tone';

/** whether the sound goes to headphones now. Kept up to date by the phone's own notice of a change. */
let headphones = false;
const listeners = new Set<(headphones: boolean) => void>();

try {
  headphones = native?.headphones() ?? false;
} catch {
  headphones = false;
}

onOutputChange((now) => {
  headphones = now;
  listeners.forEach((listener) => listener(now));
});

export const headphonesNow = (): boolean => headphones;

/** calls `listener` when the output changes between headphones and speakers; returns how to stop listening */
export function onHeadphonesChange(listener: (headphones: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
