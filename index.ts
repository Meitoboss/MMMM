import TrackPlayer from 'react-native-track-player';

import { playbackService } from './src/player/service';

// Must run before the app root is registered
TrackPlayer.registerPlaybackService(() => playbackService);

import 'expo-router/entry';
