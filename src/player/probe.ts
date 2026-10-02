import TrackPlayer, { Event } from 'react-native-track-player';

import type { SongItem } from '../core/types';
import { usePlayer } from '../state/player';

import type { StepResult } from '../core/diagnostics';
import { ascii, codecInfo, hex, listBoxes } from '../core/mp4';
import { resolveAudio } from '../core/streams/resolver';
import type { AudioSource } from '../core/types';
import { resolverOptions } from '../state/settings';
import { downloadToCache } from './localCache';
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

function attempt(url: string, extra: Record<string, unknown>, timeoutMs = 12_000, base: Record<string, unknown> = { title: 'probe', artist: 'probe' }): Promise<{ ok: boolean; detail: string }> {
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
      await TrackPlayer.add({ id: 'probe', url, ...base, ...extra } as never);
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

/* ---------- HTTP inspection helpers ---------- */

async function fetchBytes(url: string, range: string, userAgent?: string): Promise<{ status: number; bytes: Uint8Array }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { Range: range, ...(userAgent ? { 'User-Agent': userAgent } : {}) }, signal: ctl.signal });
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
  } finally {
    clearTimeout(timer);
  }
}

/** Status line only (aborts the body) – "how does googlevideo answer this kind of range?" */
async function rangeStatus(url: string, range?: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: range ? { Range: range } : {}, signal: ctl.signal });
    const line = `${range ?? 'no Range'} → ${res.status} (len ${res.headers.get('content-length') ?? '-'})`;
    ctl.abort();
    return line;
  } catch (e) {
    return `${range ?? 'no Range'} → ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    clearTimeout(timer);
  }
}

async function inspectStream(label: string, src: AudioSource, onStep: (r: StepResult) => void) {
  try {
    const head = await fetchBytes(src.url, 'bytes=0-65535');
    onStep({ name: `${label} MP4 structure`, ok: head.status === 206 || head.status === 200, detail: `HTTP ${head.status}, ${head.bytes.length} B: ${listBoxes(head.bytes)} | ${codecInfo(head.bytes)}`, ms: 0 });
  } catch (e) {
    onStep({ name: `${label} MP4 structure`, ok: false, detail: e instanceof Error ? e.message : String(e), ms: 0 });
  }
  const size = src.contentLength ?? 0;
  const ranges = ['bytes=0-1', 'bytes=0-', size ? `bytes=${Math.floor(size / 2)}-${Math.floor(size / 2) + 15}` : 'bytes=1000000-1000015', size ? `bytes=${size - 16}-` : 'bytes=-16'];
  const lines: string[] = [];
  for (const r of ranges) lines.push(await rangeStatus(src.url, r));
  lines.push(await rangeStatus(src.url));
  onStep({ name: `${label} range behaviour`, ok: true, detail: lines.join(' | '), ms: 0 });
}

/** What does googlevideo answer to AVPlayer-like requests for THIS url? */
async function httpCheck(url: string, userAgent?: string) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-15', ...(userAgent ? { 'User-Agent': userAgent } : {}) }, signal: ctl.signal });
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, 16);
    const h = (n: string) => res.headers.get(n) ?? '-';
    const ascii = Array.from(head.slice(4, 12)).map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('');
    return `HTTP ${res.status} type=${h('content-type')} range=${h('content-range')} len=${h('content-length')} first16=[${hex(head)}] "${ascii}"`;
  } catch (e) {
    return `request failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Why does THIS song fail?" – resolves the currently loaded song, inspects the HTTP answer,
 * then tries handing it to AVPlayer with progressively less metadata.
 */
export async function runCurrentSongProbe(onStep: (r: StepResult) => void): Promise<boolean> {
  await ensurePlayer();
  const song = usePlayer.getState().current;
  if (!song) {
    onStep({ name: 'A. current song', ok: false, detail: 'Tap a song in Search first, then run this test.', ms: 0 });
    return false;
  }
  const t0 = Date.now();
  let src: AudioSource;
  try {
    src = await resolveAudio(song.id, { ...resolverOptions(), order: ['webpot'], serverUrl: '' });
  } catch (e) {
    onStep({ name: `A. resolve ${song.id}`, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
    return false;
  }
  const u = src.url;
  const q = (n: string) => u.match(new RegExp(`[?&]${n}=([^&]*)`))?.[1];
  onStep({
    name: `A. resolved ${song.title}`,
    ok: true,
    detail: `itag=${src.itag} ${src.mimeType} ${Math.round((src.contentLength ?? 0) / 1024)}KB host=${u.split('/')[2]} params: n=${q('n') ? 'yes' : 'NO'} sig=${q('sig') ? 'yes' : 'no'} pot=${q('pot') ? 'yes' : 'NO'} c=${q('c') ?? '-'} mime=${q('mime') ?? '-'} clen=${q('clen') ?? '-'} dur=${q('dur') ?? '-'}`,
    ms: Date.now() - t0,
  });

  onStep({ name: 'B. HTTP (default user agent)', ok: true, detail: await httpCheck(u), ms: 0 });
  onStep({ name: 'B2. HTTP (AppleCoreMedia user agent)', ok: true, detail: await httpCheck(u, 'AppleCoreMedia/1.0.0.22B83 (iPhone; U; CPU OS 18_1 like Mac OS X; en_us)'), ms: 0 });

  await inspectStream('B3.', src, onStep);

  // reference: a song that is known to play (diagnostics 8.2) – compare structure / ranges
  try {
    const ref = await resolveAudio('dQw4w9WgXcQ', { ...resolverOptions(), order: ['webpot'], serverUrl: '' });
    const rq = (n: string) => ref.url.match(new RegExp(`[?&]${n}=([^&]*)`))?.[1];
    onStep({ name: 'R0. reference song (known to play)', ok: true, detail: `itag=${ref.itag} ${Math.round((ref.contentLength ?? 0) / 1024)}KB sig=${rq('sig') ? 'yes' : 'no'} n=${rq('n') ? 'yes' : 'NO'} c=${rq('c') ?? '-'}`, ms: 0 });
    await inspectStream('R1.', ref, onStep);
  } catch (e) {
    onStep({ name: 'R0. reference song', ok: false, detail: e instanceof Error ? e.message : String(e), ms: 0 });
  }

  const full = {
    title: song.title,
    artist: song.artists.map((a) => a.name).join(', '),
    contentType: 'audio/mp4',
  };
  const t1 = Date.now();
  const r1 = await attempt(u, full, 12_000, { title: song.title, artist: 'x' });
  onStep({ name: 'C.1 AVPlayer – remote url', ok: r1.ok, detail: r1.detail, ms: Date.now() - t1 });
  if (r1.ok) {
    await TrackPlayer.reset();
    return true;
  }

  // D: download the file first, then play the local copy
  const t2 = Date.now();
  try {
    const local = await downloadToCache(u, `probe-${song.id}`);
    onStep({ name: 'D.1 downloaded to cache', ok: true, detail: local.slice(-60), ms: Date.now() - t2 });
    const t3 = Date.now();
    const r2 = await attempt(local, { contentType: 'audio/mp4' }, 12_000, { title: song.title, artist: 'x' });
    onStep({ name: 'D.2 AVPlayer – local file', ok: r2.ok, detail: r2.detail, ms: Date.now() - t3 });
    await TrackPlayer.reset();
    return r2.ok;
  } catch (e) {
    onStep({ name: 'D.1 download', ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t2 });
    await TrackPlayer.reset();
    return false;
  }
}
