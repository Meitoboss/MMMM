import { Platform } from 'react-native';
import TrackPlayer from 'react-native-track-player';

import type { SongItem } from '../core/types';
import { focusImage } from '../ui/focusImages';
import { focusKeyOf } from './focus';
import { setFocusControls } from './setup';

/**
 * The 集中 sound on the lock screen (iPhone): its name (no second line), its photo and "LIVE" (a sound with no end), with play and pause only.
 * The sound itself plays through its own two players (focusLoop.ts); the lock screen is drawn by the song player's
 * now-playing information, whose play / pause buttons already reach the app (they pause and resume the 集中 sound).
 * Android draws its controls from a playing song only, so nothing is shown there yet.
 */
export async function showFocusOnLockScreen(song: SongItem): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await setFocusControls(true);
  await TrackPlayer.updateNowPlayingMetadata({
    title: song.title, // the name only: no second line
    artwork: focusImage(focusKeyOf(song.id)) as unknown as string | undefined, // a bundled photo: the player library resolves it
    isLiveStream: true,
  });
}

/** a song again: all the lock-screen buttons come back */
export async function leaveFocusLockScreen(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await setFocusControls(false);
}
