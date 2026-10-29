import TrackPlayer, { AppKilledPlaybackBehavior, Capability } from 'react-native-track-player';

let ready: Promise<void> | undefined;

/** Seconds between progress events. 1 s is plenty for the clock; the section loop needs finer steps to jump back on time. */
export const NORMAL_INTERVAL = 1;
export const LOOP_INTERVAL = 0.25;

let interval = NORMAL_INTERVAL;
/** true while a 集中 sound plays: the lock screen has play and pause only (no skipping, no seek bar) */
let focusControls = false;

/** The complete option set – `updateOptions` is always given all of it, so changing one thing cannot drop a button. */
function playerOptions() {
  return {
    android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification },
    capabilities: focusControls
      ? [Capability.Play, Capability.Pause]
      : [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.SeekTo],
    progressUpdateEventInterval: interval,
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
    await TrackPlayer.updateOptions(playerOptions());
  })();
  return ready;
}

/** Fine progress events only while a section loop is running (saves a little battery the rest of the time). */
export async function setProgressInterval(seconds: number): Promise<void> {
  interval = seconds;
  await ensurePlayer();
  await TrackPlayer.updateOptions(playerOptions());
}

/** the lock-screen buttons: play and pause only (a 集中 sound), or all of them (a song) */
export async function setFocusControls(on: boolean): Promise<void> {
  if (focusControls === on) return;
  focusControls = on;
  await ensurePlayer();
  await TrackPlayer.updateOptions(playerOptions());
}
