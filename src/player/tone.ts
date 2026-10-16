import * as FileSystem from 'expo-file-system/legacy';
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { type ToneLevel, toneVolume } from '../core/focus';
import { TONE_RATE, base64Encode, toneHz, toneSamples, wavBytes } from '../core/tone';


/** the tone is a native player of its own: the music player plays one sound at a time, the tone plays beside it */
let player: AudioPlayer | null = null;
let playingHz = 0;
let chain: Promise<void> = Promise.resolve();

/** the tone file for a frequency, written once into the cache folder */
async function fileFor(hz: number): Promise<string> {
  const uri = `${FileSystem.cacheDirectory ?? ''}tone-${hz.toFixed(1)}.wav`;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(uri, base64Encode(wavBytes(toneSamples(hz), TONE_RATE)), { encoding: FileSystem.EncodingType.Base64 });
  }
  return uri;
}

/** plays the tone at `requested` Hz, looping; a new frequency takes effect now. Calls run one after another. */
export function playTone(requested: number, level: ToneLevel): Promise<void> {
  chain = chain
    .then(async () => {
      const hz = toneHz(requested);
      if (!player) {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'mixWithOthers' });
        player = createAudioPlayer(null);
      }
      if (hz !== playingHz) {
        player.replace({ uri: await fileFor(hz) });
        playingHz = hz;
      }
      player.loop = true;
      player.volume = toneVolume(level);
      player.play();
    })
    .catch(() => undefined);
  return chain;
}

export function pauseTone(): void {
  player?.pause();
}
