import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

// @ts-expect-error plain JS module
import { createStreamServer } from '../server/server.mjs';

describe('stream server', () => {
  let base = '';
  let close: () => void;
  before(async () => {
    const server = createStreamServer({
      key: 'secret',
      ytdlp: join(process.cwd(), 'server/fake-ytdlp.sh'),
      cacheDir: mkdtempSync(join(tmpdir(), 'rimusic-')),
      log: () => undefined,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  after(() => close());

  it('rejects requests without the key', async () => {
    assert.equal((await fetch(`${base}/resolve?v=dQw4w9WgXcQ`)).status, 401);
  });
  it('rejects malformed ids (no command injection through the id)', async () => {
    assert.equal((await fetch(`${base}/resolve?v=${encodeURIComponent('a;rm -rf /')}&key=secret`)).status, 400);
  });
  it('resolves, caches and serves audio with range support', async () => {
    const r = await (await fetch(`${base}/resolve?v=dQw4w9WgXcQ&key=secret`)).json();
    assert.equal(r.mimeType, 'audio/mp4');
    assert.equal(r.size, 5000);
    const full = await fetch(`${base}${r.path}`);
    assert.equal(full.status, 200);
    assert.equal((await full.arrayBuffer()).byteLength, 5000);

    const part = await fetch(`${base}${r.path}`, { headers: { Range: 'bytes=100-199' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 100-199/5000');
    assert.equal((await part.arrayBuffer()).byteLength, 100);

    const tail = await fetch(`${base}${r.path}`, { headers: { Range: 'bytes=4900-' } });
    assert.equal(tail.status, 206);
    assert.equal((await tail.arrayBuffer()).byteLength, 100);

    assert.equal((await fetch(`${base}${r.path}`, { headers: { Range: 'bytes=9000-' } })).status, 416);
  });
  it('reports yt-dlp startup problems as JSON errors', async () => {
    const bad = createStreamServer({ ytdlp: '/nonexistent/yt-dlp', cacheDir: mkdtempSync(join(tmpdir(), 'rimusic-')), log: () => undefined });
    await new Promise<void>((r) => bad.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${(bad.address() as AddressInfo).port}`;
    const res = await fetch(`${b}/resolve?v=dQw4w9WgXcQ`);
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /cannot start/);
    bad.close();
  });
});
