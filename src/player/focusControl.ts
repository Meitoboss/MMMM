import type { FocusSound } from '../core/focus';
import type { SongItem } from '../core/types';
import { focusSongOf, focusKeyOf, isFocusId } from './focus';
import { pauseTone } from './tone';
import { usePlayer } from '../state/player';

/** the music that was playing before the 集中 sounds took over: it comes back, paused, where it was when the 集中 screens are left */
let before: { queue: SongItem[]; index: number; position: number; shuffle: boolean; repeat: 'off' | 'all' | 'one' } | null = null;

/** a tap on a card: its sound starts, or pauses (a sound that is not on the server yet cannot be played) */
export async function toggleFocusSound(sound: FocusSound): Promise<void> {
  if (!sound.ready) return;
  const player = usePlayer.getState();
  const isCurrent = !!player.current && focusKeyOf(player.current.id) === sound.key;
  if (isCurrent) {
    if (player.status === 'playing') {
      await player.togglePlay();
      pauseTone();
    } else {
      await player.togglePlay();
    }
    return;
  }
  if (player.current && !isFocusId(player.current.id)) {
    before = { queue: player.queue, index: player.index, position: await player.getPosition(), shuffle: player.shuffle, repeat: player.repeat };
  }
  usePlayer.setState({ shuffle: false });
  player.setRepeat('all');
  await player.playSongs([focusSongOf(sound.key)], 0);
}

/** leaving a 集中 screen: the 集中 sound stops, and the music from before comes back, paused where it was */
export function leaveFocus(): void {
  const player = usePlayer.getState();
  if (!player.current || !isFocusId(player.current.id)) return;
  pauseTone();
  void (async () => {
    if (player.status === 'playing') await player.togglePlay();
    const saved = before;
    before = null;
    if (!saved || !saved.queue.length) return;
    usePlayer.setState({ shuffle: saved.shuffle });
    player.setRepeat(saved.repeat);
    await player.playSongs(saved.queue, saved.index);
    await usePlayer.getState().seekTo(saved.position);
    if (usePlayer.getState().status === 'playing') await usePlayer.getState().togglePlay();
  })();
}
