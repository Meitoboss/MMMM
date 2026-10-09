import * as Updates from 'expo-updates';
import { create } from 'zustand';

interface OtaState {
  isUpdateAvailable: boolean;
  isChecking: boolean;
  checkForOtaUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
}

export const useOta = create<OtaState>((set) => ({
  isUpdateAvailable: false,
  isChecking: false,

  checkForOtaUpdate: async () => {
    if (Updates.isEmbeddedLaunch) {
      return;
    }

    set({ isChecking: true });
    try {
      const update = await Updates.checkForUpdateAsync();
      set({ isUpdateAvailable: update.isAvailable, isChecking: false });

      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
      }
    } catch (e) {
      console.error('OTA update check failed:', e);
      set({ isChecking: false });
    }
  },

  applyUpdate: async () => {
    try {
      await Updates.reloadAsync();
    } catch (e) {
      console.error('OTA update apply failed:', e);
    }
  },
}));
