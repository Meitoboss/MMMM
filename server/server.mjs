#!/usr/bin/env node
/**
 * RiMusic stream server – a tiny helper that runs on YOUR computer / home server.
 *
 * Why: YouTube now requires proof-of-origin (PO) tokens for audio URLs, which a phone app cannot
 * produce reliably. yt-dlp keeps up with those changes, so this server asks yt-dlp for the audio,
 * keeps a copy in a cache folder and serves it to the app (with Range support so seeking works).
 * Streams are served from here, not from YouTube, so IP-bound URLs are not a problem.
 *
 *   node server.mjs
 *
 * Env: PORT (8787) · KEY (optional shared secret) · YTDLP (yt-dlp path) · CACHE_DIR · CACHE_HOURS (24)
 *
 * Requires: Node 18+, yt-dlp (https://github.com/yt-dlp/yt-dlp), ideally ffmpeg.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function createStreamServer({
  key = process.env.KEY ?? '',
  ytdlp = process.env.YTDLP ?? 'yt-dlp',
  cacheDir = process.env.CACHE_DIR ?? join(process.cwd(), 'cache'),
  cacheHours = Number(process.env.CACHE_HOURS ?? 24),
  extraArgs = (process.env.YTDLP_ARGS ?? '').split(' ').filter(Boolean),
  log = (...a) => console.log(new Date().toISOString(), ...a),
} = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const inflight = new Map();

  const cached = (id) => readdirSync(cacheDir).find((f) => f.startsWith(`${id}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));

  function download(id) {
    if (inflight.has(id)) return inflight.get(id);
    const p = new Promise((resolve, reject) => {
      const args = [
        '-f', 'bestaudio[ext=m4a]/140/bestaudio',
        '--no-playlist', '--no-progress', '--no-warnings',
        '-o', join(cacheDir, `${id}.%(ext)s`),
        ...extraArgs,
        `https://www.youtube.com/watch?v=${id}`,
      ];
      log('yt-dlp', id);
      const child = spawn(ytdlp, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => reject(new Error(`cannot start "${ytdlp}": ${e.message}`)));
      child.on('close', (code) => {
        const f = cached(id);
        if (code === 0 && f) resolve(f);
        else reject(new Error(err.trim().split('\n').slice(-3).join(' | ') || `yt-dlp exited with ${code}`));
      });
    }).finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  const mime = (f) => (f.endsWith('.m4a') || f.endsWith('.mp4') ? 'audio/mp4' : f.endsWith('.webm') ? 'audio/webm' : 'application/octet-stream');
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  function serveFile(req, res, path, type) {
    const { size } = statSync(path);
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1] === '') {
        start = Math.max(0, size - Number(range[2])); // suffix range
      } else {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      }
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      status = 206;
    }
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(path, { start, end }).pipe(res);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (key && url.searchParams.get('key') !== key) return json(res, 401, { error: 'bad key' });

      if (url.pathname === '/health') return json(res, 200, { ok: true });

      if (url.pathname === '/resolve') {
        const id = url.searchParams.get('v') ?? '';
        if (!ID_RE.test(id)) return json(res, 400, { error: 'bad video id' });
        const file = cached(id) ?? (await download(id));
        const q = key ? `?key=${encodeURIComponent(key)}` : '';
        return json(res, 200, { path: `/audio/${file}${q}`, mimeType: mime(file), size: statSync(join(cacheDir, file)).size });
      }

      const m = /^\/audio\/([A-Za-z0-9_-]{11}\.[a-z0-9]+)$/.exec(url.pathname);
      if (m) {
        const path = join(cacheDir, m[1]);
        if (!existsSync(path)) return json(res, 404, { error: 'not cached' });
        return serveFile(req, res, path, mime(m[1]));
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      log('error', e.message);
      json(res, 500, { error: e.message });
    }
  });

  const sweep = () => {
    const limit = Date.now() - cacheHours * 3_600_000;
    for (const f of readdirSync(cacheDir)) {
      const p = join(cacheDir, f);
      try { if (statSync(p).mtimeMs < limit) unlinkSync(p); } catch { /* ignore */ }
    }
  };
  const timer = setInterval(sweep, 3_600_000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  createStreamServer().listen(port, '0.0.0.0', () => {
    console.log(`RiMusic stream server on :${port}  (key ${process.env.KEY ? 'required' : 'NOT set – anyone on your network can use it'})`);
  });
}
