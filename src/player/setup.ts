import TrackPlayer, { AppKilledPlaybackBehavior, Capability } from 'react-native-track-player';

let ready: Promise<void> | undefined;

/** Seconds between progress events. 1 s is plenty for the clock; the section loop needs finer steps to jump back on time. */
export const NORMAL_INTERVAL = 1;
export const LOOP_INTERVAL = 0.25;

/** The complete option set – `updateOptions` is always given all of it, so changing the interval cannot drop a button. */
function playerOptions(progressUpdateEventInterval: number) {
  return {
    android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification },
    capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.SeekTo],
    progressUpdateEventInterval,
  };
}

/** Idempotent: safe to call from the UI and from the playback service. */
export function ensurePlayer(): Promise<void> {
  ready ??= (async () => {
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    } catch (e) {
      if (!String(e).includes('already been initialized')) throw e;
    }
    await TrackPlayer.updateOptions(playerOptions(NORMAL_INTERVAL));
  })();
  return ready;
}

/** Fine progress events only while a section loop is running (saves a little battery the rest of the time). */
export async function setProgressInterval(seconds: number): Promise<void> {
  await ensurePlayer();
  await TrackPlayer.updateOptions(playerOptions(seconds));
}
