import * as FileSystem from 'expo-file-system/legacy';

import { setPlayerJsStore } from '../core/pot/solver';

/**
 * Keeps YouTube's player script on the phone between starts: the file holds its id on the first line, then the script.
 * Only the last one is kept, so the file never grows. The id is checked against the current player before it is used.
 */
const PATH = () => `${FileSystem.documentDirectory ?? ''}yt/player.js`;

export function startPlayerJsStore(): void {
  setPlayerJsStore({
    async read() {
      const info = await FileSystem.getInfoAsync(PATH());
      if (!info.exists) return null;
      const raw = await FileSystem.readAsStringAsync(PATH());
      const cut = raw.indexOf('\n');
      if (cut < 0) return null;
      return { id: raw.slice(0, cut), text: raw.slice(cut + 1) };
    },
    async write({ id, text }) {
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory ?? ''}yt/`, { intermediates: true });
      await FileSystem.writeAsStringAsync(PATH(), `${id}\n${text}`);
    },
  });
}
