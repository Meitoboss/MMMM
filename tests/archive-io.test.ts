import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estimateSeconds, formatBytes, formatDuration, isSongArchiveName, songArchiveFileName, spaceNeeded } from '../src/core/songArchive';
import { type FileHandleLike, type FsLike, offlineFileOps, sinkToFile, sourceFromFile } from '../src/player/archiveIo';

/** a folder in memory that behaves like Expo's files: a handle has an offset that moves, reads stop at the end */
function memFs() {
  const files = new Map<string, Uint8Array>();
  const open = new Set<string>();
  const fs: FsLike = {
    file: (uri) => ({
      get exists() { return files.has(uri); },
      create() { if (files.has(uri)) throw new Error('already exists'); files.set(uri, new Uint8Array(0)); },
      delete() { if (!files.delete(uri)) throw new Error('no such file'); },
      open(): FileHandleLike {
        if (!files.has(uri)) throw new Error('no such file');
        open.add(uri);
        let offset = 0;
        let closed = false;
        const h: FileHandleLike = {
          get offset() { return closed ? null : offset; },
          set offset(v) { offset = v ?? 0; },
          get size() { return closed ? null : files.get(uri)!.length; },
          readBytes(n) {
            if (closed) throw new Error('closed');
            const d = files.get(uri)!;
            const out = d.slice(offset, offset + n);
            offset += out.length;
            return out;
          },
          writeBytes(b) {
            if (closed) throw new Error('closed');
            const d = files.get(uri)!;
            const next = new Uint8Array(Math.max(d.length, offset + b.length));
            next.set(d);
            next.set(b, offset);
            files.set(uri, next);
            offset += b.length;
          },
          close() { closed = true; open.delete(uri); },
        };
        return h;
      },
    }),
    async move(from, to) {
      if (!files.has(from)) throw new Error('no source');
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    async remove(uri) { files.delete(uri); },
    async sizeOf(uri) { return files.get(uri)?.length ?? null; },
  };
  return { fs, files, open };
}

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('reading a file as a stream', () => {
  it('gives it all in pieces, then an empty read at the end (and keeps giving empty)', async () => {
    const m = memFs();
    m.files.set('f', bytes(1000));
    const s = sourceFromFile(m.fs, 'f');
    assert.equal(s.size, 1000);
    const got: number[] = [];
    for (;;) {
      const p = await s.source.read(333);
      if (p.length === 0) break;
      got.push(...p);
    }
    assert.deepEqual(got, [...bytes(1000)]);
    assert.equal((await s.source.read(10)).length, 0);
    assert.equal((await s.source.read(10)).length, 0);
    s.close();
    assert.equal(m.open.size, 0, 'the handle was closed');
  });
  it('never reads past the size the file had when it was opened; an empty file is just empty', async () => {
    const m = memFs();
    m.files.set('f', bytes(100));
    const s = sourceFromFile(m.fs, 'f');
    m.files.set('f', bytes(500)); // grew afterwards
    let total = 0;
    for (let p = await s.source.read(64); p.length; p = await s.source.read(64)) total += p.length;
    assert.equal(total, 100);
    m.files.set('e', new Uint8Array(0));
    assert.equal((await sourceFromFile(m.fs, 'e').source.read(10)).length, 0);
  });
  it('after close it gives nothing, and closing twice is fine; a missing file is an error', () => {
    const m = memFs();
    m.files.set('f', bytes(10));
    const s = sourceFromFile(m.fs, 'f');
    s.close();
    s.close();
    assert.equal(s.source.read(5).length, 0);
    assert.throws(() => sourceFromFile(m.fs, 'nope'), /no such file/);
  });
});

describe('writing a file', () => {
  it('writes in order, replaces an old file of that name, and closes', async () => {
    const m = memFs();
    m.files.set('out', bytes(50));
    const w = sinkToFile(m.fs, 'out');
    await w.sink.write(Uint8Array.of(1, 2, 3));
    await w.sink.write(Uint8Array.of(4, 5));
    w.close();
    w.close();
    assert.deepEqual([...m.files.get('out')!], [1, 2, 3, 4, 5]);
    assert.equal(m.open.size, 0);
  });
  it('abort closes and deletes it', async () => {
    const m = memFs();
    const w = sinkToFile(m.fs, 'out');
    await w.sink.write(bytes(100));
    await w.abort();
    assert.equal(m.files.has('out'), false);
    assert.equal(m.open.size, 0);
  });
});

describe('the folder of saved songs', () => {
  const dir = 'file:///offline/';
  it('a song is invisible until it is committed; then it is there, whole', async () => {
    const m = memFs();
    const ops = offlineFileOps(m.fs, dir);
    const f = await ops.beginFile('abc.m4a');
    await f.sink.write(bytes(300));
    assert.equal(m.files.has(`${dir}abc.m4a`), false);
    assert.ok(m.files.has(`${dir}abc.m4a.part`));
    await f.commit();
    assert.equal(m.files.has(`${dir}abc.m4a.part`), false);
    assert.equal(m.files.get(`${dir}abc.m4a`)!.length, 300);
    assert.equal(await ops.fileSize('abc.m4a'), 300);
    assert.equal(await ops.fileSize('zzz.m4a'), null);
    assert.equal(m.open.size, 0);
  });
  it('abort before commit leaves nothing; abort after commit takes the file away again', async () => {
    const m = memFs();
    const ops = offlineFileOps(m.fs, dir);
    const a = await ops.beginFile('a.m4a');
    await a.sink.write(bytes(10));
    await a.abort();
    assert.equal(m.files.size, 0);
    const b = await ops.beginFile('b.m4a');
    await b.sink.write(bytes(10));
    await b.commit();
    assert.equal(m.files.size, 1);
    await b.abort();
    assert.equal(m.files.size, 0);
    assert.equal(m.open.size, 0);
  });
  it('a leftover .part from an earlier try does not get in the way', async () => {
    const m = memFs();
    m.files.set(`${dir}x.m4a.part`, bytes(999));
    const f = await offlineFileOps(m.fs, dir).beginFile('x.m4a');
    await f.sink.write(bytes(5));
    await f.commit();
    assert.equal(m.files.get(`${dir}x.m4a`)!.length, 5);
  });
  it('a song can be opened and read back', async () => {
    const m = memFs();
    m.files.set(`${dir}s.m4a`, bytes(70));
    const f = await offlineFileOps(m.fs, dir).openFile('s.m4a');
    assert.equal((await f.source.read(1000)).length, 70);
    f.close();
  });
});

describe('names, sizes and times for the screen', () => {
  it('file names carry the date and time; the right files are offered', () => {
    assert.equal(songArchiveFileName(new Date(2026, 9, 8, 7, 5)), 'musicspace-songs-20261008-0705.msbx');
    for (const n of ['musicspace-songs-20261008-0705.msbx', 'x.MSBX', 'musicspace-songs-1.msbx.bin']) assert.ok(isSongArchiveName(n), n);
    for (const n of ['backup.json', 'song.mp3', 'x.msbx.txt', `${'a'.repeat(300)}.msbx`]) assert.ok(!isSongArchiveName(n), n);
  });
  it('sizes in words', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(900), '900 B');
    assert.equal(formatBytes(2048), '2 KB');
    assert.equal(formatBytes(5.5 * 1024 * 1024), '5.5 MB');
    assert.equal(formatBytes(250 * 1024 * 1024), '250 MB');
    assert.equal(formatBytes(1.5 * 1024 ** 3), '1.5 GB');
    assert.equal(formatBytes(-1), '—');
    assert.equal(formatBytes(Number.NaN), '—');
  });
  it('time in words, and an estimate that grows with the size', () => {
    assert.equal(formatDuration(30), '1分未満');
    assert.equal(formatDuration(150), '約3分');
    assert.equal(formatDuration(3600), '約1時間');
    assert.equal(formatDuration(3900), '約1時間5分');
    assert.ok(estimateSeconds(0) >= 5);
    assert.ok(estimateSeconds(900 * 1024 * 1024) > estimateSeconds(10 * 1024 * 1024));
    assert.ok(estimateSeconds(300_000_000) >= 100, 'about 3 MB a second');
    assert.ok(spaceNeeded(100) > 100 && spaceNeeded(1e9) > 1e9);
  });
});
