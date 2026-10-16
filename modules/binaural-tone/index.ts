import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The sine tone of the 集中 mode, made live by the phone (not from a file), so it never has an end.
 * `beatHz` is the difference between the left and right ear (0 = the same tone in both ears).
 * On a build without this module, `native` is null and the caller does nothing.
 */
interface BinauralToneNative {
  start(baseHz: number, beatHz: number, volume: number): void;
  setVolume(volume: number): void;
  stop(): void;
}

export const native = requireOptionalNativeModule<BinauralToneNative>('BinauralTone');
