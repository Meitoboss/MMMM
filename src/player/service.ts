import { Platform } from 'react-native';
import TrackPlayer, { Event, State } from 'react-native-track-player';

import { reassertLockLength, usePlayer } from '../state/player';
import { noteProgress } from '../state/resume';

/** Registered in index.ts – handles lock-screen / Control Center / headset buttons and track events. */
export async function playbackService() {
  const p = () => usePlayer.getState();

  // the lock-screen buttons are written to the log (with the app's state then), so a button that does nothing can be traced.
  // Play and pause do what they say even when the app's state is behind the player's (a toggle would then do nothing)
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    p().log(`remote: play (status=${p().status})`);
    if (p().needsLoad || p().status === 'paused' || p().status === 'error') void p().togglePlay();
    else void TrackPlayer.play().then(() => p().setStatus('playing')).catch(() => undefined);
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    p().log(`remote: pause (status=${p().status})`);
    if (p().status === 'playing') void p().togglePlay();
    else void TrackPlayer.pause().then(() => p().setStatus('paused')).catch(() => undefined);
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    p().log('remote: next');
    void p().next();
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    p().log('remote: previous');
    void p().previous();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => {
    p().log(`remote: seek ${Math.round(e.position)}s`);
    void p().seekTo(e.position);
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => void TrackPlayer.pause());

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    p().log('event: queueEnded');
    void p().onEnded();
  });
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e) => {
    p().tick();
    p().checkLoop(e.position);
    p().checkTransition(e.position, e.duration);
    noteProgress(e.position);
  });
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => p().log(`event: activeTrack idx=${e.index ?? '-'}`));
  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    p().log(`event: ERROR ${JSON.stringify(e)}`);
    usePlayer.setState({ status: 'error', error: `Player error ${e.code}: ${e.message}` });
  });
  TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
    p().log(`event: state=${e.state}`);
    if (Platform.OS === 'ios') reassertLockLength(); // iOS has just written the file's length back (Android keeps what it was given)
    const cur = p().status;
    if (cur === 'loading' || cur === 'idle') {
      if (e.state === State.Playing) p().setStatus('playing');
      return;
    }
    if (e.state === State.Playing) p().setStatus('playing');
    else if (e.state === State.Paused) p().setStatus('paused');
  });
}
