import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The home screen widget (iOS) reads the state of the 集中 sound from the shared App Group, and its play / pause button
 * arrives here as `onToggle`. On a build without this module (or on Android), `native` is null and nothing happens.
 */
export interface WidgetBridgeNative {
  /** the state as JSON (see core/widget.ts) */
  setState(json: string): void;
  /** copies the cover photo (a file on the phone) into the shared folder */
  setCover(path: string): void;
}

type WidgetEvents = { onToggle: () => void };

export const native = requireOptionalNativeModule<WidgetBridgeNative>('WidgetBridge');

const emitter = native ? new EventEmitter<WidgetEvents>(native as never) : null;

/** calls `listener` when the widget's play / pause button is pressed; returns how to stop listening */
export function onWidgetToggle(listener: () => void): () => void {
  if (!emitter) return () => undefined;
  const sub = emitter.addListener('onToggle', listener);
  return () => sub.remove();
}
