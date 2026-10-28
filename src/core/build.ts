import Constants from 'expo-constants';

/**
 * The beta app (the "trial" channel, see scripts/apply-ota.mjs): the things that are still being tried are shown only there.
 */
export const isBetaBuild = (): boolean => Constants.expoConfig?.extra?.otaChannel === 'trial';
