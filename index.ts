import { installCrashRecorder, installSafeMode, registerStartupError } from './src/crash';

// Must run first: records uncaught JS errors, and replaces a failed start-up with an error screen.
installCrashRecorder();
// If the last run ended with a fatal error, its first screen is the error (and the app opens only from there)
const undoSafeMode = installSafeMode();

try {
  // plain require (not import) so an error in any module is caught here instead of closing the app
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TrackPlayer = require('react-native-track-player').default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { playbackService } = require('./src/player/service');
  // Must run before the app root is registered
  TrackPlayer.registerPlaybackService(() => playbackService);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-router/entry');
} catch (e) {
  undoSafeMode(); // this error is the one to show, not the older one
  registerStartupError(e);
}
