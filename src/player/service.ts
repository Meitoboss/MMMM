import TrackPlayer, { Event, State } from 'react-native-track-player';

import { usePlayer } from '../state/player';

/** Registered in index.ts – handles lock-screen / Control Center / headset buttons and track events. */
export async function playbackService() {
  const p = () => usePlayer.getState();

  TrackPlayer.addEventListener(Event.RemotePlay, () => void p().togglePlay());
  TrackPlayer.addEventListener(Event.RemotePause, () => void p().togglePlay());
  TrackPlayer.addEventListener(Event.RemoteNext, () => void p().next());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => void p().previous());
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => void p().seekTo(e.position));
  TrackPlayer.addEventListener(Event.RemoteStop, () => void TrackPlayer.pause());

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => void p().onEnded());
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, () => p().tick());
  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    usePlayer.setState({ status: 'error', error: e.message });
  });
  TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
    const cur = p().status;
    if (cur === 'loading' || cur === 'idle') {
      if (e.state === State.Playing) p().setStatus('playing');
      return;
    }
    if (e.state === State.Playing) p().setStatus('playing');
    else if (e.state === State.Paused) p().setStatus('paused');
  });
}
