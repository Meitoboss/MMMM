import { Asset } from 'expo-asset';

import { native, onWidgetToggle } from '../../modules/widget-bridge';
import { FOCUS_SOUNDS } from '../core/focus';
import { widgetPayload } from '../core/widget';
import { focusImage } from '../ui/focusImages';
import { focusKeyOf, isFocusId, soundPitch } from './focus';
import { usePlayer } from '../state/player';

/**
 * Keeps the home screen widget in line with the 集中 sound: its name, beat and play state, and its photo.
 * The widget's play / pause button toggles the sound here. Does nothing where the widget bridge is not in the build.
 */

let lastKey = '';
let coverKey = '';

function publish(st: ReturnType<typeof usePlayer.getState>): void {
  if (!native) return;
  const current = st.current;
  if (!current || !isFocusId(current.id)) {
    if (lastKey !== 'off') native.setState(widgetPayload(null));
    lastKey = 'off';
    return;
  }
  const key = focusKeyOf(current.id);
  const playing = st.status === 'playing';
  const id = `${key}|${playing}`;
  if (id === lastKey) return;
  lastKey = id;
  const sound = FOCUS_SOUNDS.find((x) => x.key === key);
  native.setState(widgetPayload({ title: sound?.name ?? current.title, hz: soundPitch(key).beat, playing }));
  if (coverKey !== key) void setCover(key);
}

/** the photo of the sound, copied into the shared folder (once per sound) */
async function setCover(key: string): Promise<void> {
  const image = focusImage(key);
  if (!native || typeof image !== 'number') return;
  try {
    const asset = Asset.fromModule(image);
    await asset.downloadAsync();
    if (asset.localUri) {
      native.setCover(asset.localUri);
      coverKey = key;
    }
  } catch {
    /* the widget shows a colour instead of the photo */
  }
}

/** starts the sync; returns how to stop it */
export function startWidgetSync(): () => void {
  if (!native) return () => undefined;
  const stopListening = onWidgetToggle(() => {
    const st = usePlayer.getState();
    if (st.current && isFocusId(st.current.id)) void st.togglePlay();
  });
  const unsubscribe = usePlayer.subscribe(publish);
  publish(usePlayer.getState());
  return () => {
    stopListening();
    unsubscribe();
  };
}
