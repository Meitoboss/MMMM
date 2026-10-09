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
      console.log('OTA: Embedded launch, skipping update check');
      return;
    }

    set({ isChecking: true });
    try {
      const update = await Updates.checkForUpdateAsync();
      console.log('OTA: Update check result:', update.isAvailable);
      set({ isUpdateAvailable: update.isAvailable, isChecking: false });

      if (update.isAvailable) {
        console.log('OTA: Fetching update...');
        await Updates.fetchUpdateAsync();
        console.log('OTA: Update fetched successfully');
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
