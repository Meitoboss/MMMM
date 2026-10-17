import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The binaural tone, made live on the phone (iOS and Android), so it never has an end.
 * - `center` is the middle pitch in Hz; the left ear hears center − beat/2 and the right ear center + beat/2.
 * - `tone` and `noise` are amplitudes (0 to 1). The pitch and loudness glide to new values; start / stop fade over about 1 s.
 * - `headphones()` says whether headphones (wired or Bluetooth) are the output now.
 * On a build without this module, `native` is null and the caller does nothing.
 */
export interface BinauralToneNative {
  start(center: number, beat: number, tone: number, noise: number): void;
  update(center: number, beat: number, tone: number, noise: number): void;
  stop(): void;
  headphones(): boolean;
}

type OutputEvents = { onOutputChange: (event: { headphones: boolean }) => void };

export const native = requireOptionalNativeModule<BinauralToneNative>('BinauralTone');

const emitter = native ? new EventEmitter<OutputEvents>(native as never) : null;

/** calls `listener` whenever the output changes between headphones and speakers; returns how to stop listening */
export function onOutputChange(listener: (headphones: boolean) => void): () => void {
  if (!emitter) return () => undefined;
  const sub = emitter.addListener('onOutputChange', (e) => listener(e.headphones));
  return () => sub.remove();
}
