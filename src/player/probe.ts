import TrackPlayer, { Event } from 'react-native-track-player';

import type { SongItem } from '../core/types';
import { usePlayer } from '../state/player';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays through the REAL path (usePlayer.playSongs → resolver → TrackPlayer) and records everything
 * AVPlayer reports, so "no error but no sound" can be explained from one screenshot.
 */
export async function runRealPathTest(onStep: (r: StepResult) => void): Promise<boolean> {
  await ensurePlayer();
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const log: string[] = [];
  const subs = [
    TrackPlayer.addEventListener(Event.PlaybackState, (e) => log.push(`${stamp()} state=${e.state}`)),
    TrackPlayer.addEventListener(Event.PlaybackError, (e) => log.push(`${stamp()} ERROR ${JSON.stringify(e)}`)),
    TrackPlayer.addEventListener(Event.PlaybackQueueEnded, (e) => log.push(`${stamp()} queueEnded ${JSON.stringify(e)}`)),
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => log.push(`${stamp()} activeTrack idx=${e.index}`)),
    TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e) => log.push(`${stamp()} pos=${e.position.toFixed(1)}/${e.duration.toFixed(0)}`)),
  ];

  const cur = usePlayer.getState().current;
  const song: SongItem = cur ?? { kind: 'song', id: 'dQw4w9WgXcQ', title: 'Test', artists: [{ name: 'Test' }], explicit: false };
  try {
    await usePlayer.getState().playSongs([song], 0);
    await sleep(8000);

    const st = usePlayer.getState();
    const [state, progress, rate, volume, track] = await Promise.all([
      TrackPlayer.getPlaybackState(),
      TrackPlayer.getProgress(),
      TrackPlayer.getRate(),
      TrackPlayer.getVolume(),
      TrackPlayer.getActiveTrack(),
    ]);
    const host = String(track?.url ?? '').split('/')[2] ?? 'no track';
    const ok = progress.position > 1;

    onStep({ name: `9.1 Real path – app state (${song.id})`, ok: st.status === 'playing', detail: `status=${st.status} error=${st.error ?? '-'} index=${st.index}/${st.queue.length}`, ms: Date.now() - t0 });
    onStep({
      name: '9.2 Real path – AVPlayer',
      ok,
      detail: `state=${JSON.stringify(state)} position=${progress.position.toFixed(1)} duration=${progress.duration.toFixed(0)} rate=${rate} volume=${volume} host=${host}`,
      ms: 0,
    });
    const keep = log.filter((l) => !l.includes('pos=') || /pos=\d+\.0/.test(l)).slice(-14);
    onStep({ name: '9.3 Real path – event log', ok, detail: keep.join(' | ') || '(no events at all)', ms: 0 });
    return ok;
  } finally {
    subs.forEach((s) => s.remove());
  }
}
