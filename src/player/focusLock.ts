import { Platform } from 'react-native';
import TrackPlayer, { RepeatMode } from 'react-native-track-player';

import type { SongItem } from '../core/types';
import { focusImage } from '../ui/focusImages';
import { focusKeyOf } from './focus';
import { setFocusControls } from './setup';

/** a few seconds of silence, played over and over while a 集中 sound plays (iPhone) */
const SILENCE = require('../../assets/silence.m4a');

/**
 * The 集中 sound on the lock screen (iPhone): its name (no second line), its photo and "LIVE", with play and pause only.
 *
 * The sound itself plays through its own two players (focusLoop.ts). The lock screen belongs to the song player, and the
 * song player gives it up as soon as it has nothing to play (it stops taking the lock-screen buttons). So while a 集中 sound
 * plays, the song player plays silence over and over, carrying the sound's name and photo; its play and pause buttons reach
 * the app and pause and resume the 集中 sound. Android is left as it was.
 */
export async function showFocusOnLockScreen(song: SongItem): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await setFocusControls(true);
  await TrackPlayer.reset();
  await TrackPlayer.add({
    id: `lock:${song.id}`,
    url: SILENCE,
    title: song.title, // the name only: no second line
    artwork: focusImage(focusKeyOf(song.id)) as unknown as string | undefined, // a bundled photo: the player library resolves it
    isLiveStream: true,
  });
  await TrackPlayer.setRepeatMode(RepeatMode.Track);
  await TrackPlayer.play();
}

/** the 集中 sound was paused or resumed in the app: the lock screen follows */
export async function setFocusLockPlaying(playing: boolean): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (playing) await TrackPlayer.play();
  else await TrackPlayer.pause();
}

/** a song again: the silence stops repeating and all the lock-screen buttons come back */
export async function leaveFocusLockScreen(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await TrackPlayer.setRepeatMode(RepeatMode.Off);
  await setFocusControls(false);
}
