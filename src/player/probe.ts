import TrackPlayer, { Event } from 'react-native-track-player';

import type { StepResult } from '../core/diagnostics';
import { resolveAudio } from '../core/streams/resolver';
import type { AudioSource } from '../core/types';
import { resolverOptions } from '../state/settings';
import { ensurePlayer } from './setup';

interface Variant {
  name: string;
  build: (src: AudioSource) => Record<string, unknown>;
}

/** Different ways of handing the same URL to AVPlayer – we find out which one actually makes sound. */
export const VARIANTS: Variant[] = [
  { name: 'user-agent + audio/mp4 hint', build: (s) => ({ userAgent: s.userAgent, contentType: 'audio/mp4' }) },
  { name: 'audio/mp4 hint only', build: () => ({ contentType: 'audio/mp4' }) },
  { name: 'plain url', build: () => ({}) },
  {
    name: 'user-agent + Origin/Referer headers',
    build: (s) => ({
      userAgent: s.userAgent,
      contentType: 'audio/mp4',
      headers: { Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' },
    }),
  },
];

function attempt(url: string, extra: Record<string, unknown>, timeoutMs = 12_000): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let done = false;
    let lastState = '?';
    const subs: { remove: () => void }[] = [];
    const finish = (r: { ok: boolean; detail: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subs.forEach((s) => s.remove());
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: `no sound within ${timeoutMs / 1000}s (last state: ${lastState})` }), timeoutMs);

    subs.push(TrackPlayer.addEventListener(Event.PlaybackError, (e) => finish({ ok: false, detail: `error ${e.code}: ${e.message}` })));
    subs.push(TrackPlayer.addEventListener(Event.PlaybackState, (e) => { lastState = String(e.state); }));
    subs.push(
      TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e) => {
        if (e.position > 0.5) finish({ ok: true, detail: `playing – position ${e.position.toFixed(1)}s of ${e.duration.toFixed(0)}s` });
      }),
    );

    (async () => {
      await TrackPlayer.reset();
      await TrackPlayer.add({ id: 'probe', url, title: 'probe', artist: 'probe', ...extra } as never);
      await TrackPlayer.play();
    })().catch((e) => finish({ ok: false, detail: `add/play threw: ${e instanceof Error ? e.message : String(e)}` }));
  });
}

/** Step 8 of the self-test: does AVPlayer play the resolved stream? Stops at the first variant that works. */
export async function runPlaybackProbe(onStep: (r: StepResult) => void, videoId = 'dQw4w9WgXcQ'): Promise<boolean> {
  await ensurePlayer();
  let src: AudioSource;
  try {
    src = await resolveAudio(videoId, { ...resolverOptions(), order: ['webpot'], serverUrl: '' });
  } catch (e) {
    onStep({ name: '8. AVPlayer test', ok: false, detail: `could not resolve: ${e instanceof Error ? e.message : String(e)}`, ms: 0 });
    return false;
  }
  for (const [i, v] of VARIANTS.entries()) {
    const t0 = Date.now();
    const r = await attempt(src.url, v.build(src));
    onStep({ name: `8.${i + 1} AVPlayer – ${v.name}`, ok: r.ok, detail: r.detail, ms: Date.now() - t0 });
    if (r.ok) {
      await TrackPlayer.reset();
      return true;
    }
  }
  await TrackPlayer.reset();
  return false;
}
