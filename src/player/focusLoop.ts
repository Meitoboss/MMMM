import { type AudioMetadata, type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

/**
 * The 集中 sounds, played with two players (expo-audio) so the loop has no gap and no click.
 * The sound is the whole file. When the first player nears the end, the second one starts from its beginning and the two
 * cross-fade over FADE_SEC: the file's last seconds fade into its first seconds, so the loop is heard as one sound.
 * It plays with the screen off (shouldPlayInBackground). The lock screen shows the sound: the player that is heard is the one it follows.
 */

/** how long the two players cross-fade (seconds) */
export const FADE_SEC = 20;
const TICK_MS = 100;

let players: [AudioPlayer, AudioPlayer] | null = null;
let duration = 0;
/** the player that is heard (0 or 1) when no cross-fade is running */
let active = 0;
/** the loudness the sound plays at (before any cross-fade) */
let level = 1;
let audible = false;
let timer: ReturnType<typeof setInterval> | undefined;
let crossing: { from: number; to: number; startedAt: number } | null = null;
/** what the lock screen shows for the sound */
let lockMeta: AudioMetadata | undefined;

/** the length of the file in seconds (expo-audio fills it in once the file is ready) */
async function waitForDuration(p: AudioPlayer): Promise<number> {
  for (let i = 0; i < 100; i++) {
    if (p.duration > 0) return p.duration;
    await new Promise((r) => setTimeout(r, 50));
  }
  return 0;
}

/** loads one 集中 sound from a file on the phone; it is not playing yet */
export async function loadFocusLoop(uri: string, volume: number, meta: AudioMetadata): Promise<void> {
  stopFocusLoop();
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
  const a = createAudioPlayer({ uri }, { updateInterval: 100 });
  const b = createAudioPlayer({ uri }, { updateInterval: 100 });
  players = [a, b];
  level = volume;
  active = 0;
  lockMeta = meta;
  a.setActiveForLockScreen(true, meta);
  a.volume = volume;
  b.volume = 0;
  duration = await waitForDuration(a);
  if (duration === 0) {
    // the length is not known: the player repeats the file itself (a little gap is possible here)
    a.loop = true;
    b.loop = true;
  }
}

export function playFocusLoop(): void {
  if (!players) return;
  audible = true;
  if (!crossing) players[active].play();
  if (!timer) timer = setInterval(tick, TICK_MS);
}

export function pauseFocusLoop(): void {
  if (!players) return;
  audible = false;
  if (crossing) {
    // a pause in the middle of a cross-fade ends it: the new player is the one that is heard
    players[crossing.from].pause();
    players[crossing.to].volume = level;
    active = crossing.to;
    crossing = null;
  }
  players.forEach((p) => p.pause());
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** the loudness of the sound (the tone and the environment settings change it) */
export function setFocusLoopVolume(volume: number): void {
  level = volume;
  if (players && !crossing) players[active].volume = volume;
}

/** where the sound is, in seconds */
export function focusLoopPosition(): number {
  return players ? players[active].currentTime : 0;
}

export function stopFocusLoop(): void {
  pauseFocusLoop();
  if (players) {
    players.forEach((p) => {
      p.clearLockScreenControls();
      p.remove();
    });
  }
  players = null;
  lockMeta = undefined;
  crossing = null;
  duration = 0;
  active = 0;
}

function tick(): void {
  if (!players || !audible) return;
  if (crossing) {
    const k = Math.min(1, (Date.now() - crossing.startedAt) / (FADE_SEC * 1000));
    players[crossing.from].volume = level * (1 - k);
    players[crossing.to].volume = level * k;
    if (k >= 1) {
      players[crossing.from].pause();
      active = crossing.to;
      crossing = null;
    }
    return;
  }
  const from = players[active];
  if (duration > 0 && from.currentTime >= duration - FADE_SEC) {
    const to = active === 0 ? 1 : 0;
    const next = players[to];
    next.volume = 0;
    crossing = { from: active, to, startedAt: Date.now() };
    // the lock screen follows the player that is heard from now on
    players[crossing.from].setActiveForLockScreen(false);
    next.setActiveForLockScreen(true, lockMeta);
    void next.seekTo(0).then(() => next.play());
  }
}
