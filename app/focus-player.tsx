import { useEffect } from 'react';

import { FocusPlayer } from '../src/ui/FocusPlayer';
import { setFocusPlayerOpen } from '../src/player/focusControl';

/** the player of the 集中 sounds: its own screen, so it never opens the usual player */
export default function FocusPlayerScreen() {
  useEffect(() => {
    setFocusPlayerOpen(true);
    return () => setFocusPlayerOpen(false);
  }, []);
  return <FocusPlayer />;
}
