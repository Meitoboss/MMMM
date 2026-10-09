import assert from 'node:assert/strict';
import { randomBytes as nodeRandom } from 'node:crypto';
import { describe, it } from 'node:test';

import { ArchiveError, ArchiveWriter, type ByteSink, type ByteSource, memorySink, memorySource } from '../src/core/archive';
import { REC_LIBRARY, REC_MANIFEST, REC_SONG, type RestoreDeps, exportSongArchive, isValidSongId, openSongArchive, parseManifest, parseSongMeta, restoreSongArchive, restoredFileName } from '../src/core/songArchive';
import type { SongItem } from '../src/core/types';
import type { Db } from '../src/db/driver';
import * as repo from '../src/db/repo';
import { migrate } from '../src/db/schema';
import { applyLibraryJson, hasOfflineRow, libraryAsJson, listExportSongs, saveRestoredSong } from '../src/db/songArchive';
import { nodeDb } from './helpers/nodeDb';

const KEY = 'purple-river-lamp-seven';
const FAST = { iterations: 1000, chunkSize: 4096 };
const rnd = (n: number): Uint8Array => new Uint8Array(nodeRandom(n));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const song = (id: string, title: string, extra: Partial<SongItem> = {}): SongItem => ({ kind: 'song', id, title, artists: [{ name: `Artist of ${id}` }], explicit: false, durationText: '3:30', thumbnail: `https://img/${id}.jpg`, ...extra });
const fresh = async (): Promise<Db> => {
  const db = nodeDb();
  await migrate(db);
  return db;
};

/** a folder of files in memory, with ways to make it fail */
class FakeFs {
  files = new Map<string, Uint8Array>();
  failWritesAfterBytes = Infinity;
  private written = 0;
  readLog = 0;
  size = async (name: string) => this.files.get(name)?.length ?? null;
  open = async (name: string) => {
    const data = this.files.get(name);
    if (!data) throw new Error(`no file ${name}`);
    const src = memorySource(data, 5000);
    const counted: ByteSource = { read: async (n) => { const r = await src.read(n); this.readLog += r.length; return r; } };
    return { source: counted, close: () => undefined };
  };
  begin = async (name: string) => {
    assert.match(name, /^[A-Za-z0-9_-]{1,64}\.(m4a|webm|ogg|mp4)$/, `a safe file name, got ${name}`);
    const parts: Uint8Array[] = [];
    let committed = false;
    const sink: ByteSink = {
      write: (b) => {
        this.written += b.length;
        if (this.written > this.failWritesAfterBytes) throw new Error('容量が足りません');
        parts.push(Uint8Array.from(b));
      },
    };
    return {
      sink,
      commit: async () => {
        this.files.set(name, Buffer.concat(parts));
        committed = true;
      },
      abort: async () => {
        if (committed) this.files.delete(name);
        parts.length = 0;
      },
    };
  };
}

/** a phone with a few saved songs */
async function phoneWithSongs(): Promise<{ db: Db; fs: FakeFs }> {
  const db = await fresh();
  const fs = new FakeFs();
  const songs = [
    { s: song('aaaaaaaaaaa', 'Alpha'), mime: 'audio/mp4', bytes: 300_000, loud: -7.5 },
    { s: song('bbbbbbbbbbb', 'Beta (explicit)', { explicit: true }), mime: 'audio/webm', bytes: 50_000, loud: null },
    { s: song('ccccccccccc', '曲名 🎵'), mime: 'audio/mp4', bytes: 4096, loud: 2.25 }, // exactly one chunk
    { s: song('ddddddddddd', 'Delta'), mime: 'audio/mp4', bytes: 40_000, loud: -3 },
  ];
  for (const x of songs) {
    const name = `${x.s.id}${x.mime === 'audio/webm' ? '.webm' : '.m4a'}`;
    fs.files.set(name, rnd(x.bytes));
    await repo.addOffline(db, x.s, { fileName: name, size: x.bytes, mimeType: x.mime });
    if (x.loud !== null) await repo.saveFormat(db, x.s, { mimeType: x.mime, loudnessDb: x.loud });
  }
  const mix = await repo.createPlaylist(db, 'ドライブ');
  await repo.addToPlaylist(db, mix, [songs[2].s, songs[0].s]);
  await repo.toggleLike(db, songs[1].s);
  return { db, fs };
}

async function exportAll(db: Db, fs: FakeFs, over: Record<string, unknown> = {}) {
  const sink = memorySink();
  const result = await exportSongArchive({
    songs: await listExportSongs(db),
    fileSize: fs.size,
    openFile: fs.open,
    library: await libraryAsJson(db),
    sink,
    secretKey: KEY,
    appVersion: '1.0.2',
    ...FAST,
    ...over,
  } as Parameters<typeof exportSongArchive>[0]);
  return { bytes: sink.bytes(), result };
}

function restoreDeps(db: Db, fs: FakeFs, reader: RestoreDeps['reader'], manifest: RestoreDeps['manifest'], over: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    reader,
    manifest,
    hasSong: async (id) => (await hasOfflineRow(db, id)) && fs.files.has(`${id}.m4a`) ,
    beginFile: fs.begin,
    saveSong: (m, f) => saveRestoredSong(db, m, f),
    importLibrary: (text) => applyLibraryJson(db, text),
    ...over,
  };
}

describe('a whole phone → file → another phone', () => {
  it('every saved song comes back byte for byte, with its title, explicit mark, sound level and playlists', async () => {
    const a = await phoneWithSongs();
    const { bytes, result } = await exportAll(a.db, a.fs);
    assert.equal(result.included, 4);
    assert.deepEqual(result.skipped, []);

    const b = { db: await fresh(), fs: new FakeFs() };
    const { reader, manifest } = await openSongArchive(memorySource(bytes, 3000), KEY, { });
    assert.equal(manifest.songs.length, 4);
    assert.equal(manifest.hasLibrary, true);
    assert.equal(manifest.totalBytes, 300_000 + 50_000 + 4096 + 40_000);
    const rep = await restoreSongArchive(restoreDeps(b.db, b.fs, reader, manifest, { hasSong: async (id) => hasOfflineRow(b.db, id) }));
    assert.deepEqual({ restored: rep.restored, alreadyHad: rep.alreadyHad, invalid: rep.invalid, library: rep.libraryRestored }, { restored: 4, alreadyHad: 0, invalid: 0, library: true });

    for (const [name, data] of a.fs.files) assert.equal(hex(b.fs.files.get(name)!), hex(data), name);
    assert.deepEqual(new Set(b.fs.files.keys()), new Set(a.fs.files.keys()), 'nothing else was written');
    const got = await repo.offlineSongs(b.db);
    assert.deepEqual(got.map((s) => s.id).sort(), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']);
    assert.equal(got.find((s) => s.id === 'bbbbbbbbbbb')!.explicit, true);
    assert.equal(got.find((s) => s.id === 'ccccccccccc')!.title, '曲名 🎵');
    assert.equal(await repo.loudnessFor(b.db, 'aaaaaaaaaaa'), -7.5);
    assert.equal(await repo.loudnessFor(b.db, 'bbbbbbbbbbb'), null);
    assert.equal(await repo.loudnessFor(b.db, 'ccccccccccc'), 2.25);
    assert.equal((await repo.offlineFile(b.db, 'bbbbbbbbbbb'))!.mimeType, 'audio/webm');
    // the library came along
    const playlists = await repo.playlists(b.db);
    assert.deepEqual(playlists.map((p) => p.name), ['ドライブ']);
    assert.deepEqual((await repo.playlistSongs(b.db, playlists[0].id)).map((s) => s.id), ['ccccccccccc', 'aaaaaaaaaaa']);
    assert.equal(await repo.isLiked(b.db, 'bbbbbbbbbbb'), true);
  });

  it('the archive does not hold a single readable title, id or byte of the songs', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    const text = Buffer.from(bytes).toString('latin1');
    for (const needle of ['Alpha', 'Beta', 'aaaaaaaaaaa', 'music-space', 'ドライブ', 'audio/mp4']) assert.ok(!text.includes(needle), needle);
    for (const f of a.fs.files.values()) assert.ok(!Buffer.from(bytes).includes(Buffer.from(f.subarray(0, 64))), 'no song bytes in the clear');
  });

  it('a second restore of the same file changes nothing: the songs are already there', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    const b = { db: await fresh(), fs: new FakeFs() };
    const run = async () => {
      const { reader, manifest } = await openSongArchive(memorySource(bytes), KEY);
      return restoreSongArchive(restoreDeps(b.db, b.fs, reader, manifest, { hasSong: async (id) => (await hasOfflineRow(b.db, id)) && b.fs.files.has(`${id}.m4a`) || b.fs.files.has(`${id}.webm`) }));
    };
    assert.equal((await run()).restored, 4);
    const snapshot = [...b.fs.files.entries()].map(([k, v]) => `${k}:${hex(v.subarray(0, 8))}`).sort().join('|');
    const again = await run();
    assert.deepEqual({ restored: again.restored, alreadyHad: again.alreadyHad }, { restored: 0, alreadyHad: 4 });
    assert.equal([...b.fs.files.entries()].map(([k, v]) => `${k}:${hex(v.subarray(0, 8))}`).sort().join('|'), snapshot);
  });

  it('a song that is already saved here is kept as it is (not overwritten)', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    const b = { db: await fresh(), fs: new FakeFs() };
    const mine = rnd(30_000);
    b.fs.files.set('aaaaaaaaaaa.m4a', mine);
    await repo.addOffline(b.db, song('aaaaaaaaaaa', 'Alpha (mine)'), { fileName: 'aaaaaaaaaaa.m4a', size: 30_000, mimeType: 'audio/mp4' });
    const { reader, manifest } = await openSongArchive(memorySource(bytes), KEY);
    const rep = await restoreSongArchive(restoreDeps(b.db, b.fs, reader, manifest));
    assert.deepEqual({ restored: rep.restored, alreadyHad: rep.alreadyHad }, { restored: 3, alreadyHad: 1 });
    assert.equal(hex(b.fs.files.get('aaaaaaaaaaa.m4a')!), hex(mine));
    assert.equal((await repo.getSong(b.db, 'aaaaaaaaaaa'))!.title, 'Alpha (mine)');
  });

  it('a saved song whose file has disappeared is skipped (and reported); the rest is fine', async () => {
    const a = await phoneWithSongs();
    a.fs.files.delete('bbbbbbbbbbb.webm');
    const { bytes, result } = await exportAll(a.db, a.fs);
    assert.deepEqual(result.skipped.map((s) => s.id), ['bbbbbbbbbbb']);
    const { manifest } = await openSongArchive(memorySource(bytes), KEY);
    assert.deepEqual(manifest.songs.map((s) => s.id).sort(), ['aaaaaaaaaaa', 'ccccccccccc', 'ddddddddddd']);
  });

  it('without the library, only the songs go in; with no songs and no library there is nothing to do', async () => {
    const a = await phoneWithSongs();
    const noLib = await exportAll(a.db, a.fs, { library: undefined });
    assert.equal((await openSongArchive(memorySource(noLib.bytes), KEY)).manifest.hasLibrary, false);
    const empty = await fresh();
    await assert.rejects(() => exportAll(empty, new FakeFs(), { library: undefined }), /保存した曲が、ありません/);
    const libOnly = await exportAll(empty, new FakeFs());
    assert.equal(libOnly.result.included, 0);
  });
});

describe('opening shows what is inside without reading the rest', () => {
  it('a wrong key is told right away, and only the first chunk is read to find out', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    let read = 0;
    const src = memorySource(bytes);
    const metered: ByteSource = { read: async (n) => { const r = await src.read(n); read += r.length; return r; } };
    await assert.rejects(() => openSongArchive(metered, 'not the key at all!!'), (e: ArchiveError) => e.code === 'wrong-key');
    assert.ok(read < 4096 * 3, `read ${read} of ${bytes.length}`);
  });
  it('the preview lists the songs and their size', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    const { manifest } = await openSongArchive(memorySource(bytes), KEY);
    assert.deepEqual(manifest.songs.find((s) => s.id === 'ddddddddddd'), { id: 'ddddddddddd', title: 'Delta', size: 40_000 });
    assert.equal(manifest.appVersion, '1.0.2');
    assert.match(manifest.createdAt, /^\d{4}-\d\d-\d\dT/);
  });
  it('not a backup / not a song archive', async () => {
    await assert.rejects(() => openSongArchive(memorySource(rnd(500)), KEY), (e: ArchiveError) => e.code === 'not-archive');
    // a valid archive that is not a song archive (its first record is not a manifest)
    const sink = memorySink();
    const w = await ArchiveWriter.create(sink, KEY, FAST);
    await w.writeRecord(9, { x: 1 }, new Uint8Array(3));
    await w.finish();
    await assert.rejects(() => openSongArchive(memorySource(sink.bytes()), KEY), (e: ArchiveError) => e.code === 'unsupported');
    // a manifest that is nonsense
    const s2 = memorySink();
    const w2 = await ArchiveWriter.create(s2, KEY, FAST);
    await w2.writeRecord(REC_MANIFEST, { app: 'other' }, new Uint8Array(0));
    await w2.finish();
    await assert.rejects(() => openSongArchive(memorySource(s2.bytes()), KEY), (e: ArchiveError) => e.code === 'corrupt');
  });
});

describe('a file that cannot be trusted', () => {
  async function hostile(records: { type: number; meta: unknown; data: Uint8Array }[], manifestSongs: unknown[] = []) {
    const sink = memorySink();
    const w = await ArchiveWriter.create(sink, KEY, FAST);
    await w.writeRecord(REC_MANIFEST, { app: 'music-space', kind: 'songs', version: 1, createdAt: '', appVersion: '', hasLibrary: false, songs: manifestSongs }, new Uint8Array(0));
    for (const r of records) await w.writeRecord(r.type, r.meta, r.data);
    await w.finish();
    return sink.bytes();
  }

  it('bad ids, folders in names, local files, wrong types and sizes: skipped – and nothing is written outside the safe name', async () => {
    const good = { id: 'goodgoodgoo', title: 'Fine', artists: ['A'], explicit: false, mimeType: 'audio/mp4' };
    const records = [
      { type: REC_SONG, meta: { ...good, id: '../../etc/passwd', fileName: '../../x' }, data: rnd(100) },
      { type: REC_SONG, meta: { ...good, id: 'local:abc' }, data: rnd(100) },
      { type: REC_SONG, meta: { ...good, id: '' }, data: rnd(100) },
      { type: REC_SONG, meta: { ...good, id: 'has space' }, data: rnd(100) },
      { type: REC_SONG, meta: { ...good, id: 'x'.repeat(65) }, data: rnd(100) },
      { type: REC_SONG, meta: { ...good, id: 'emptyfile01', title: '' }, data: rnd(100) },
      { type: REC_SONG, meta: { ...good, id: 'zerosize001' }, data: new Uint8Array(0) },
      { type: REC_SONG, meta: 'just text', data: rnd(10) },
      { type: REC_SONG, meta: null, data: rnd(10) },
      { type: REC_SONG, meta: { ...good, mimeType: 'text/html', fileName: 'evil.html' }, data: rnd(777) },
      { type: 77, meta: { future: true }, data: rnd(10) },
    ];
    const bytes = await hostile(records);
    const fs = new FakeFs();
    const db = await fresh();
    const { reader, manifest } = await openSongArchive(memorySource(bytes), KEY);
    const rep = await restoreSongArchive(restoreDeps(db, fs, reader, manifest, { hasSong: async () => false }));
    assert.equal(rep.restored, 1, 'only the one valid song');
    assert.equal(rep.invalid, 9, 'nine records that cannot be a song; the one of an unknown type is simply left alone');
    assert.deepEqual([...fs.files.keys()], ['goodgoodgoo.m4a'], 'the type was not in the allowed list, so the name uses the default extension, and no name came from the archive');
    assert.equal((await repo.offlineSongs(db)).length, 1);
  });

  it('every file name that is made is safe, whatever the id looks like', () => {
    for (const id of ['abc', 'AbC-_123', 'a'.repeat(64)]) assert.match(restoredFileName({ id, mimeType: 'audio/webm' } as never), /^[A-Za-z0-9_-]+\.webm$/);
    assert.ok(!isValidSongId('../x') && !isValidSongId('a/b') && !isValidSongId('a\\b') && !isValidSongId('a.b') && !isValidSongId('local:1') && !isValidSongId(5) && !isValidSongId(null));
    assert.ok(isValidSongId('dQw4w9WgXcQ'));
  });

  it('what an archive says about a song is cleaned: lengths, types, the picture address, the sound level', () => {
    const m = parseSongMeta({ id: 'abcdefghijk', title: 'T'.repeat(1000), artists: Array(50).fill('A'.repeat(500)).concat([5, null]), explicit: 'yes', durationText: 'x'.repeat(100), thumbnail: 'javascript:alert(1)', mimeType: 'Audio/MP4; codecs="mp4a"', loudnessDb: 1e9 })!;
    assert.equal(m.title.length, 300);
    assert.equal(m.artists.length, 20);
    assert.ok(m.artists.every((a) => a.length === 100));
    assert.equal(m.explicit, false);
    assert.equal(m.durationText!.length, 20);
    assert.equal(m.thumbnail, null);
    assert.equal(m.mimeType, 'audio/mp4');
    assert.equal(m.loudnessDb, null);
    assert.equal(parseSongMeta({ id: 'abcdefghijk', title: 'ok', thumbnail: 'https://i.ytimg.com/vi/x.jpg', loudnessDb: -6.5 })!.loudnessDb, -6.5);
  });

  it('a manifest with a million made-up songs, or wrong sizes, is cut down or refused', () => {
    assert.equal(parseManifest({ app: 'music-space', kind: 'songs', version: 1, songs: Array(60_000).fill({ id: 'a', size: 1 }) }), null);
    const m = parseManifest({ app: 'music-space', kind: 'songs', version: 1, songs: [{ id: 'ok', title: 'x', size: 10 }, { id: 'bad id', size: 5 }, { id: 'neg', size: -1 }, { id: 'huge', size: 1e15 }, { id: 'nan', size: NaN }, 7] })!;
    assert.deepEqual(m.songs.map((s) => s.id), ['ok']);
    assert.equal(m.totalBytes, 10);
    assert.equal(parseManifest({ app: 'music-space', kind: 'songs', version: 2, songs: [] }), null);
    assert.equal(parseManifest(null), null);
  });

  it('a damaged library inside does not stop the songs; the problem is reported', async () => {
    const bytes = await hostile([
      { type: REC_LIBRARY, meta: { kind: 'library' }, data: Uint8Array.from(Buffer.from('this is not json')) },
      { type: REC_SONG, meta: { id: 'goodgoodgoo', title: 'Fine', mimeType: 'audio/mp4' }, data: rnd(500) },
    ]);
    const db = await fresh();
    const fs = new FakeFs();
    const { reader, manifest } = await openSongArchive(memorySource(bytes), KEY);
    const rep = await restoreSongArchive(restoreDeps(db, fs, reader, manifest, { hasSong: async () => false }));
    assert.equal(rep.restored, 1);
    assert.equal(rep.libraryRestored, false);
    assert.match(rep.libraryError ?? '', /JSON/);
  });
});

describe('when something goes wrong half way', () => {
  it('a full disk: the half-written file is gone, the songs before it stay, the database knows only complete songs', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    const b = { db: await fresh(), fs: new FakeFs() };
    b.fs.failWritesAfterBytes = 330_000; // enough for the first two files (300 000 + 4 096 … in the order saved), not the third
    const { reader, manifest } = await openSongArchive(memorySource(bytes), KEY);
    await assert.rejects(() => restoreSongArchive(restoreDeps(b.db, b.fs, reader, manifest, { hasSong: async (id) => hasOfflineRow(b.db, id) })), /容量が足りません/);
    const rows = (await repo.offlineSongs(b.db)).map((s) => s.id);
    const files = [...b.fs.files.keys()].map((n) => n.split('.')[0]).sort();
    assert.deepEqual(files, [...rows].sort(), 'every file has its row and every row its file – nothing half');
    assert.ok(rows.length >= 1 && rows.length < 4, `${rows.length} restored before the disk was full`);
  });

  it('the database failing after a file was written: that file is removed again', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    const b = { db: await fresh(), fs: new FakeFs() };
    let n = 0;
    const { reader, manifest } = await openSongArchive(memorySource(bytes), KEY);
    await assert.rejects(
      () => restoreSongArchive(restoreDeps(b.db, b.fs, reader, manifest, { hasSong: async () => false, saveSong: async (m, f) => { if (++n === 2) throw new Error('database is locked'); await saveRestoredSong(b.db, m, f); } })),
      /database is locked/,
    );
    assert.equal(b.fs.files.size, 1, 'the first song is complete, the second one left nothing behind');
    assert.equal((await repo.offlineSongs(b.db)).length, 1);
  });

  it('cancelling stops at once, and nothing half-written stays', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    const b = { db: await fresh(), fs: new FakeFs() };
    let polls = 0;
    const { reader, manifest } = await openSongArchive(memorySource(bytes), KEY);
    await assert.rejects(() => restoreSongArchive(restoreDeps(b.db, b.fs, reader, manifest, { hasSong: async () => false, isCancelled: () => ++polls > 8 })), (e: ArchiveError) => e.code === 'cancelled');
    const rows = (await repo.offlineSongs(b.db)).map((s) => s.id).sort();
    assert.deepEqual([...b.fs.files.keys()].map((k) => k.split('.')[0]).sort(), rows);
  });

  it('a file that was cut short while restoring: the song being written is removed, and the error says so', async () => {
    const a = await phoneWithSongs();
    const { bytes } = await exportAll(a.db, a.fs);
    const b = { db: await fresh(), fs: new FakeFs() };
    const { reader, manifest } = await openSongArchive(memorySource(bytes.subarray(0, Math.floor(bytes.length * 0.6))), KEY);
    await assert.rejects(() => restoreSongArchive(restoreDeps(b.db, b.fs, reader, manifest, { hasSong: async () => false })), (e: ArchiveError) => e.code === 'corrupt');
    const rows = (await repo.offlineSongs(b.db)).map((s) => s.id).sort();
    assert.deepEqual([...b.fs.files.keys()].map((k) => k.split('.')[0]).sort(), rows, 'no file without a row');
  });

  it('writing: cancelling stops it; a file that changes size while being read is an error; progress only goes forward', async () => {
    const a = await phoneWithSongs();
    let polls = 0;
    await assert.rejects(() => exportAll(a.db, a.fs, { isCancelled: () => ++polls > 20 }), (e: ArchiveError) => e.code === 'cancelled');

    const grown = await phoneWithSongs();
    const orig = grown.fs.size;
    grown.fs.size = async (n) => (n.startsWith('aaaa') ? (await orig(n))! - 100 : orig(n)); // it says it is smaller than it is
    await assert.rejects(() => exportAll(grown.db, grown.fs), (e: ArchiveError) => e.code === 'size-mismatch');

    const seen: { done: number; bytesDone: number }[] = [];
    await exportAll(a.db, a.fs, { onProgress: (p: { done: number; bytesDone: number }) => seen.push(p) });
    assert.ok(seen.length > 4);
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i].done >= seen[i - 1].done && seen[i].bytesDone >= seen[i - 1].bytesDone, `step ${i}`);
    assert.equal(seen.at(-1)!.done, 4);
    assert.equal(seen.at(-1)!.bytesDone, 394_096);
  });
});

describe('a larger collection', () => {
  it('300 songs of 20 KB: written and restored, each byte-identical', async () => {
    const db = await fresh();
    const fs = new FakeFs();
    for (let i = 0; i < 300; i++) {
      const id = `song${String(i).padStart(7, '0')}`;
      fs.files.set(`${id}.m4a`, rnd(20_000));
      await repo.addOffline(db, song(id, `Song ${i}`), { fileName: `${id}.m4a`, size: 20_000, mimeType: 'audio/mp4' });
    }
    const t0 = Date.now();
    const { bytes } = await exportAll(db, fs, { chunkSize: 65536 });
    const target = { db: await fresh(), fs: new FakeFs() };
    const { reader, manifest } = await openSongArchive(memorySource(bytes, 40000), KEY);
    const rep = await restoreSongArchive(restoreDeps(target.db, target.fs, reader, manifest, { hasSong: async (id) => hasOfflineRow(target.db, id) }));
    assert.equal(rep.restored, 300);
    for (const [name, data] of fs.files) assert.equal(hex(target.fs.files.get(name)!), hex(data));
    assert.ok(Date.now() - t0 < 30_000);
  });
});
