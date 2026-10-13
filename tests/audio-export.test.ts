import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { AUDIO_CHUNK, type AudioExportDeps, type AudioOutput, audioBaseName, audioExtension, audioMime, cleanFileName, exportAudioFiles, extensionFor, planNames } from '../src/core/audioExport';
import { type ByteSink, memorySource } from '../src/core/archive';
import type { ExportSong } from '../src/core/songArchive';

const mk = (id: string, title: string, artist: string | null, over: Partial<ExportSong> = {}): ExportSong => ({
  song: { kind: 'song', id, title, artists: artist ? [{ name: artist }] : [], explicit: false } as ExportSong['song'],
  fileName: `${id}.m4a`,
  mimeType: 'audio/mp4',
  loudnessDb: null,
  ...over,
});

describe('the name and type of an audio file', () => {
  it('the type of the saved song decides: AAC is m4a, Opus is webm; unknown types fall back to the saved file name, then to m4a', () => {
    assert.equal(audioExtension('audio/mp4'), 'm4a');
    assert.equal(audioExtension('audio/mp4; codecs="mp4a.40.2"'), 'm4a');
    assert.equal(audioExtension('AUDIO/WEBM; codecs=opus'), 'webm');
    assert.equal(audioExtension('audio/ogg'), 'ogg');
    assert.equal(audioExtension('audio/mpeg'), 'mp3');
    for (const v of [null, undefined, '', 'video/mp4', 'text/html']) assert.equal(audioExtension(v), null, String(v));
    assert.equal(extensionFor(mk('a', 'A', 'B', { mimeType: null, fileName: 'x.WEBM' })), 'webm');
    assert.equal(extensionFor(mk('a', 'A', 'B', { mimeType: null, fileName: 'noextension' })), 'm4a');
    assert.equal(audioMime('m4a'), 'audio/mp4');
    assert.equal(audioMime('webm'), 'audio/webm');
    assert.equal(audioMime('xyz'), 'application/octet-stream');
  });

  it('a name is "Artist - Title"; several artists are joined; with no artist it is the title', () => {
    assert.equal(audioBaseName({ title: 'ドラマツルギー', artists: [{ name: 'Eve' }] }), 'Eve - ドラマツルギー');
    assert.equal(audioBaseName({ title: 'Song', artists: [{ name: 'A' }, { name: 'B' }] }), 'A, B - Song');
    assert.equal(audioBaseName({ title: 'Solo', artists: [] }), 'Solo');
    assert.equal(audioBaseName({ title: 'e:Explicit Title', artists: [{ name: 'X' }] }), 'X - Explicit Title', 'the explicit mark is not part of the name');
  });

  it('marks that file systems forbid are replaced, control characters and blanks are tidied, dots and spaces at the ends are removed', () => {
    assert.equal(cleanFileName('AC/DC: Back In Black?'), 'AC_DC_ Back In Black_');
    assert.equal(cleanFileName('a<b>c|d"e*f\\g'), 'a_b_c_d_e_f_g');
    assert.equal(cleanFileName('  two   spaces\tand\nlines  '), 'two spaces and lines');
    assert.equal(cleanFileName('...hidden'), 'hidden');
    assert.equal(cleanFileName('ends with dots...'), 'ends with dots');
    assert.equal(cleanFileName('bell\u0007ring'), 'bell ring');
  });

  it('never empty; very long names are cut by letters (not in the middle of a letter); Japanese and emoji are kept', () => {
    for (const v of ['', '   ', '...', '///']) assert.ok(cleanFileName(v).length > 0, JSON.stringify(v));
    assert.equal(cleanFileName(''), 'song');
    const long = cleanFileName('あ'.repeat(300));
    assert.equal(Array.from(long).length, 90);
    assert.equal(cleanFileName('🎵'.repeat(200)), '🎵'.repeat(90), 'emoji count as one letter and are not cut in half');
    assert.equal(cleanFileName('曲名 🎵'), '曲名 🎵');
  });

  it('every name in a plan is different (also when only the case differs), and keeps its own extension', () => {
    const plan = planNames([
      mk('a', 'Same', 'Artist'),
      mk('b', 'Same', 'Artist'),
      mk('c', 'same', 'artist'),
      mk('d', 'Same', 'Artist', { mimeType: 'audio/webm', fileName: 'd.webm' }),
      mk('e', 'Other', null),
    ]);
    assert.deepEqual(plan.map((p) => p.name), ['Artist - Same.m4a', 'Artist - Same (2).m4a', 'artist - same (3).m4a', 'Artist - Same.webm', 'Other.m4a']);
    assert.equal(new Set(plan.map((p) => p.name.toLowerCase())).size, plan.length);
    assert.equal(plan[3].mime, 'audio/webm');
    assert.deepEqual(planNames([]), []);
  });
});

/* ---------------------------------------------------------------------------------------------- copying */
class FakeStorage {
  files = new Map<string, Uint8Array>(); // saved songs
  out = new Map<string, Uint8Array>(); // the audio files that were made
  begun: string[] = [];
  aborted: string[] = [];
  failAfterBytes = Infinity;
  private written = 0;
  pieces: number[] = [];
  deps(songs: ExportSong[], over: Partial<AudioExportDeps> = {}): AudioExportDeps {
    return {
      songs,
      fileSize: async (n) => this.files.get(n)?.length ?? null,
      openFile: async (n) => {
        const d = this.files.get(n);
        if (!d) throw new Error(`no ${n}`);
        return { source: memorySource(d, 300_000), close: () => undefined };
      },
      begin: async (name, mime) => {
        this.begun.push(name);
        assert.ok(mime.startsWith('audio/'), mime);
        const parts: Uint8Array[] = [];
        const sink: ByteSink = {
          write: (b) => {
            this.written += b.length;
            if (this.written > this.failAfterBytes) throw new Error('容量が足りません');
            this.pieces.push(b.length);
            parts.push(Uint8Array.from(b));
          },
        };
        const o: AudioOutput = {
          sink,
          commit: async () => void this.out.set(name, Buffer.concat(parts)),
          abort: async () => void this.aborted.push(name),
        };
        return o;
      },
      ...over,
    };
  }
}
const world = (...sizes: number[]) => {
  const fs = new FakeStorage();
  const songs = sizes.map((n, i) => {
    const s = mk(`id${i}`, `Song ${i}`, 'Band');
    fs.files.set(s.fileName, new Uint8Array(randomBytes(n)));
    return s;
  });
  return { fs, songs };
};
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('writing the audio files', () => {
  it('every song becomes a file with its name, and the bytes are exactly the saved bytes (no conversion)', async () => {
    const { fs, songs } = world(5000, 700_000, 1);
    const r = await exportAudioFiles(fs.deps(songs));
    assert.deepEqual(r.written.map((w) => w.name), ['Band - Song 0.m4a', 'Band - Song 1.m4a', 'Band - Song 2.m4a']);
    for (const [i, s] of songs.entries()) assert.equal(hex(fs.out.get(`Band - Song ${i}.m4a`)!), hex(fs.files.get(s.fileName)!));
    assert.equal(r.bytes, 705_001);
    assert.deepEqual({ skipped: r.skipped.length, cancelled: r.cancelled }, { skipped: 0, cancelled: false });
  });

  it('a file is copied in pieces of at most one megabyte (never the whole song in memory)', async () => {
    const { fs, songs } = world(3_500_000);
    await exportAudioFiles(fs.deps(songs));
    assert.ok(fs.pieces.length >= 3);
    assert.ok(Math.max(...fs.pieces) <= AUDIO_CHUNK);
  });

  it('a saved song whose file has disappeared is skipped and reported; the rest is written; progress counts only what is written', async () => {
    const { fs, songs } = world(1000, 2000, 3000);
    fs.files.delete(songs[1].fileName);
    const seen: { done: number; total: number; bytesDone: number; bytesTotal: number }[] = [];
    const r = await exportAudioFiles(fs.deps(songs, { onProgress: (p) => void seen.push({ done: p.done, total: p.total, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal }) }));
    assert.deepEqual(r.skipped.map((s) => s.id), ['id1']);
    assert.equal(r.written.length, 2);
    assert.ok(seen.every((p) => p.total === 2 && p.bytesTotal === 4000));
    assert.deepEqual(seen.at(-1), { done: 2, total: 2, bytesDone: 4000, bytesTotal: 4000 });
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i].bytesDone >= seen[i - 1].bytesDone, 'progress only goes forward');
  });

  it('a file of zero bytes is skipped too (it is not a song)', async () => {
    const { fs, songs } = world(0, 10);
    const r = await exportAudioFiles(fs.deps(songs));
    assert.deepEqual(r.skipped.map((s) => s.id), ['id0']);
    assert.equal(r.written.length, 1);
  });

  it('cancelling before it starts, or between two songs: what is finished stays, nothing else is begun', async () => {
    const { fs, songs } = world(1000, 1000, 1000);
    let n = 0;
    const r = await exportAudioFiles(fs.deps(songs, { isCancelled: () => n++ >= 3 }));
    assert.equal(r.cancelled, true);
    assert.ok(r.written.length >= 1 && r.written.length < 3);
    for (const w of r.written) assert.ok(fs.out.has(w.name), 'finished files stay');
    assert.ok(fs.begun.length <= r.written.length + 1);
    const before = await exportAudioFiles(fs.deps(songs, { isCancelled: () => true }));
    assert.deepEqual({ cancelled: before.cancelled, written: before.written.length }, { cancelled: true, written: 0 });
  });

  it('cancelling in the middle of a song removes that half file (and only that one)', async () => {
    const { fs, songs } = world(900_000, 3_000_000);
    let reads = 0;
    const deps = fs.deps(songs, { isCancelled: () => fs.pieces.length >= 4 && reads++ >= 0 });
    const r = await exportAudioFiles(deps);
    assert.equal(r.cancelled, true);
    assert.equal(r.written.length, 1);
    assert.deepEqual(fs.aborted, ['Band - Song 1.m4a']);
    assert.ok(!fs.out.has('Band - Song 1.m4a'));
    assert.ok(fs.out.has('Band - Song 0.m4a'));
  });

  it('a full disk: the error comes out, the half file is removed, the finished ones stay', async () => {
    const { fs, songs } = world(300_000, 300_000, 300_000);
    fs.failAfterBytes = 450_000;
    await assert.rejects(() => exportAudioFiles(fs.deps(songs)), /容量が足りません/);
    assert.deepEqual(fs.aborted, ['Band - Song 1.m4a']);
    assert.ok(fs.out.has('Band - Song 0.m4a') && !fs.out.has('Band - Song 1.m4a') && !fs.out.has('Band - Song 2.m4a'));
  });

  it('a file that changes size while it is copied is an error, and leaves nothing', async () => {
    const { fs, songs } = world(5000);
    const sizes = [5000, 6000]; // the size said first, then the real size is more
    const deps = fs.deps(songs, { fileSize: async () => sizes.shift() ?? 6000 });
    fs.files.set(songs[0].fileName, new Uint8Array(randomBytes(6000)));
    await assert.rejects(() => exportAudioFiles(deps), /大きさが変わりました/);
    assert.deepEqual(fs.aborted, ['Band - Song 0.m4a']);
    assert.equal(fs.out.size, 0);
  });

  it('the source file is closed after every song, also after an error', async () => {
    const { fs, songs } = world(100, 100);
    let closed = 0;
    let opened = 0;
    const base = fs.deps(songs);
    await exportAudioFiles({ ...base, openFile: async (n) => { opened++; const f = await base.openFile(n); return { source: f.source, close: () => void closed++ }; } });
    assert.equal(opened, 2);
    assert.equal(closed, 2);
    closed = 0;
    fs.failAfterBytes = 50;
    await assert.rejects(() => exportAudioFiles({ ...base, openFile: async (n) => { const f = await base.openFile(n); return { source: f.source, close: () => void closed++ }; } }));
    assert.equal(closed, 1);
  });

  it('nothing to write is fine', async () => {
    const { fs } = world();
    assert.deepEqual(await exportAudioFiles(fs.deps([])), { written: [], skipped: [], bytes: 0, cancelled: false });
  });
});
