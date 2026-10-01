import TrackPlayer, { AppKilledPlaybackBehavior, Capability } from 'react-native-track-player';

let ready: Promise<void> | undefined;

/** Idempotent: safe to call from the UI and from the playback service. */
export function ensurePlayer(): Promise<void> {
  ready ??= (async () => {
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    } catch (e) {
      if (!String(e).includes('already been initialized')) throw e;
    }
    await TrackPlayer.updateOptions({
      android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      progressUpdateEventInterval: 1,
    });
  })();
  return ready;
}
