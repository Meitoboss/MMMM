# Music space (TypeScript / React Native)

**Music space** – a TypeScript re-implementation, based on [RiMusic](https://github.com/fast4x/RiMusic) (Kotlin Multiplatform, Android/Desktop)
for **iOS**, built with Expo + React Native. Licensed **GPL-3.0-or-later**, like the original.

## Layout

| Path | What | Ported from |
|---|---|---|
| `src/core/innertube/` | YouTube Music client: search, suggestions, home, album, playlist, artist, queue/radio, player | `extensions/environment` |
| `src/core/lyrics/` | LRCLIB + KuGou lyrics, LRC parser | `extensions/lrclib`, `extensions/kugou` |
| `src/core/streams/` | Audio URL resolver (InnerTube iOS client → Piped → Invidious) | `Environment.simplePlayer`, `extensions/piped`, `extensions/invidious` |
| `src/db/` | SQLite schema (identical to Room v23) + repository | `composeApp/.../database` |
| `src/state/` | Player queue/radio/sleep timer, settings | `PlayerService`, preferences |
| `src/player/` | `react-native-track-player` setup + lock-screen service | Media3 service |
| `app/` | Screens (expo-router) | `composeApp/.../ui` |

`src/core` and `src/db` have no React Native imports and are covered by unit tests (`npm test`).

## Features

Ported: search (all filters, suggestions, history, paging), home shelves, albums, playlists (with continuation),
artists, radio / autoplay, queue management, background playback + lock-screen controls, synced lyrics
(auto-fetch + cache), likes, local playlists (create / rename / reorder / delete), bookmarked albums & artists,
play history, listening statistics (today … all time), sleep timer, playback speed, shuffle / repeat, settings.

**Not ported yet** (Android-only or large): Android Auto / TV / widgets, equalizer, audio visualizer, offline downloads,
Google account login + library sync, YouTube-side playlist editing, charts / moods / podcasts pages, Piped account
playlist sync, theme editor, Crowdin translations (UI is English), backup import/export, self-update check.

## Important notes

* **Client identifiers.** The Kotlin app read its InnerTube client names/versions/keys from Android resources
  (`env_*`) that are not in the public repository. `src/core/config.ts` uses publicly known defaults. YouTube retires
  old versions regularly – if search or playback stops working, update the versions in **Settings → Advanced**.
* **Playback (phone only, same method as RiMusic).** A hidden WebView runs YouTube's BotGuard to mint PO tokens
  (`src/core/pot/potoken.ts`, port of `PoTokenWebView.kt`), the `player` request is sent with the token and
  `signatureTimestamp`, and signature / `n` challenges are solved with yt-dlp's *ejs* solver
  (`src/core/pot/solver.ts`, replaces NewPipeExtractor). `npm run fetch-solver` bundles the solver at build time (CI does
  this). When YouTube changes its player, **rebuild** to pick up the newest solver. Fallbacks: Piped → Invidious, and
  optionally your own `server/` (yt-dlp on a PC).
* iOS can't play WebM/Opus, so only AAC/MP4 streams are selected.
* Using YouTube Music this way is against YouTube's Terms of Service, and such apps are not accepted by the App Store.
  The workflow builds an **unsigned** IPA for sideloading (AltStore, Sideloadly, TrollStore…).

## Develop

```bash
npm install
npm run typecheck:core && npm test      # no Xcode needed
npx expo prebuild --platform ios        # on a Mac
npx expo run:ios
```

## Build the IPA on GitHub

1. Push this folder to a GitHub repository (branch `main`).
2. **Actions → "Build iOS IPA (unsigned)"** runs automatically (or *Run workflow*).
3. Download `RiMusic-unsigned-ipa` from the run's artifacts. Pushing a tag like `v0.1.0` also attaches it to a Release.
4. Sideload with a tool that signs with your own Apple ID.

Change `ios.bundleIdentifier` in `app.json` to your own identifier.

## Android

The same TypeScript code builds for Android (Expo / React Native). Platform differences are isolated:

| Area | iOS | Android |
|---|---|---|
| Menus / text prompts | system `ActionSheetIOS` / `Alert.prompt` | `src/ui/dialogs.tsx` draws a bottom sheet and a text dialog |
| Playable audio | AAC in MP4 only (AVPlayer) | any `audio/*`, WebM/Opus when no AAC is offered (ExoPlayer) – `isPlayableMime`, `pickAudioFormat` |
| Local music | Files app → *On My iPhone → Music space → Music*, import **moves** the files | pick a folder once (system folder picker), import **copies** and remembers what it took |
| Notifications | – | Android 13+ asks for the notification permission (lock-screen controls) |
| Build | `.github/workflows/ios-ipa.yml` → unsigned `.ipa` | `.github/workflows/android-apk.yml` → `MusicSpace-android.apk` (signed with the debug key, for sideloading) |

Note: `react-native-track-player` 4.x cannot be loaded by the New Architecture on Android (issue #2489), so the Android workflow builds with `newArchEnabled=false`. iOS keeps the new architecture.

Build the APK: push to `main` (or run the *Build Android APK* workflow) and download the `MusicSpace-android-apk` artifact.
Locally: `npx expo prebuild --platform android && cd android && ./gradlew assembleRelease`.
