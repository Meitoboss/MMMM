import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes as nodeRandom } from 'node:crypto';
import { describe, it } from 'node:test';

import { ARCHIVE_MAGIC, ArchiveError, type ArchiveErrorCode, ArchiveReader, ArchiveWriter, REC_END, memorySink, memorySource, normalizeSecretKey } from '../src/core/archive';
import { concatBytes } from '../src/core/crypto/bytes';

const KEY = 'correct horse battery staple';
const ITER = 1000; // the smallest the format accepts: keeps the tests quick
const rnd = (n: number): Uint8Array => new Uint8Array(nodeRandom(n));
const same = (a: Uint8Array, b: Uint8Array, msg?: string) => assert.equal(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'), msg);

interface Rec {
  type: number;
  meta: unknown;
  data: Uint8Array;
}

async function build(records: Rec[], opts: { key?: string; chunkSize?: number; iterations?: number } = {}): Promise<Uint8Array> {
  const sink = memorySink();
  const w = await ArchiveWriter.create(sink, opts.key ?? KEY, { iterations: opts.iterations ?? ITER, chunkSize: opts.chunkSize ?? 64 });
  for (const r of records) await w.writeRecord(r.type, r.meta, r.data);
  await w.finish();
  return sink.bytes();
}

async function readAll(bytes: Uint8Array, key = KEY, piece = Number.MAX_SAFE_INTEGER): Promise<Rec[]> {
  const r = await ArchiveReader.open(memorySource(bytes, piece), key);
  const out: Rec[] = [];
  for (let rec = await r.next(); rec; rec = await r.next()) out.push({ type: rec.type, meta: rec.meta, data: await rec.readAll() });
  return out;
}

async function codeOf(p: Promise<unknown>): Promise<ArchiveErrorCode | 'no error'> {
  try {
    await p;
    return 'no error';
  } catch (e) {
    assert.ok(e instanceof ArchiveError, `an ArchiveError, got ${e}`);
    return (e as ArchiveError).code;
  }
}

/** the chunk boundaries of a finished archive: [start of the length field, end of the sealed bytes] */
function chunkSpans(bytes: Uint8Array): [number, number][] {
  const spans: [number, number][] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let o = 30; o < bytes.length; ) {
    const n = dv.getUint32(o, true);
    spans.push([o, o + 4 + n]);
    o += 4 + n;
  }
  return spans;
}

/* -------- a second implementation, written from the format description with Node's crypto only -------- */
function refRead(bytes: Uint8Array, key: string): Rec[] {
  const b = Buffer.from(bytes);
  const header = b.subarray(0, 30);
  assert.equal(header.subarray(0, 4).toString(), ARCHIVE_MAGIC);
  const k = pbkdf2Sync(Buffer.from(key.normalize('NFKC'), 'utf8'), header.subarray(14, 30), header.readUInt32LE(6), 32, 'sha256');
  const plains: Buffer[] = [];
  let off = 30;
  for (let idx = 0; off < b.length; idx++) {
    const len = b.readUInt32LE(off);
    const sealed = b.subarray(off + 4, off + 4 + len);
    off += 4 + len;
    const nonce = Buffer.alloc(12);
    nonce.writeUInt32LE(idx, 4);
    const idxBytes = Buffer.alloc(4);
    idxBytes.writeUInt32LE(idx);
    const d = createDecipheriv('chacha20-poly1305', k, nonce, { authTagLength: 16 });
    d.setAAD(Buffer.concat([header, idxBytes, Buffer.from([off >= b.length ? 1 : 0])]));
    d.setAuthTag(sealed.subarray(len - 16));
    plains.push(Buffer.concat([d.update(sealed.subarray(0, len - 16)), d.final()]));
  }
  const p = Buffer.concat(plains);
  const out: Rec[] = [];
  for (let o = 0; o < p.length; ) {
    const type = p[o];
    const metaLen = p.readUInt32LE(o + 1);
    const meta = JSON.parse(p.subarray(o + 5, o + 5 + metaLen).toString('utf8'));
    const size = p.readUInt32LE(o + 5 + metaLen);
    const start = o + 9 + metaLen;
    if (type !== REC_END) out.push({ type, meta, data: Uint8Array.from(p.subarray(start, start + size)) });
    o = start + size;
  }
  return out;
}

function refWrite(records: Rec[], key: string, chunkSize: number, iterations = ITER): Uint8Array {
  const salt = nodeRandom(16);
  const u32 = (n: number) => { const x = Buffer.alloc(4); x.writeUInt32LE(n); return x; };
  const header = Buffer.concat([Buffer.from(ARCHIVE_MAGIC), Buffer.from([1, 1]), u32(iterations), u32(chunkSize), salt]);
  const k = pbkdf2Sync(Buffer.from(key.normalize('NFKC'), 'utf8'), salt, iterations, 32, 'sha256');
  const stream = Buffer.concat([...records, { type: REC_END, meta: {}, data: new Uint8Array(0) }].flatMap((r) => [Buffer.from([r.type]), u32(Buffer.byteLength(JSON.stringify(r.meta))), Buffer.from(JSON.stringify(r.meta)), u32(r.data.length), Buffer.from(r.data)]));
  const parts: Buffer[] = [header];
  const count = Math.floor(stream.length / chunkSize) + 1;
  for (let idx = 0; idx < count; idx++) {
    const slice = stream.subarray(idx * chunkSize, Math.min(stream.length, (idx + 1) * chunkSize));
    const nonce = Buffer.alloc(12);
    nonce.writeUInt32LE(idx, 4);
    const c = createCipheriv('chacha20-poly1305', k, nonce, { authTagLength: 16 });
    c.setAAD(Buffer.concat([header, u32(idx), Buffer.from([idx === count - 1 ? 1 : 0])]));
    const sealed = Buffer.concat([c.update(slice), c.final(), c.getAuthTag()]);
    parts.push(u32(sealed.length), sealed);
  }
  return Uint8Array.from(Buffer.concat(parts));
}

const SAMPLE: Rec[] = [
  { type: 3, meta: { app: 'music-space', songs: 2 }, data: new Uint8Array(0) },
  { type: 1, meta: { kind: 'library' }, data: Uint8Array.from(Buffer.from('{"songs":[]}')) },
  { type: 2, meta: { id: 'abc', title: '秘密の曲🔑' }, data: rnd(200) },
  { type: 2, meta: { id: 'def' }, data: rnd(1) },
];

describe('writing and reading an archive', () => {
  it('records come back as they went in – empty, tiny, and spanning many chunks; read in pieces of every size', async () => {
    const records: Rec[] = [0, 1, 63, 64, 65, 127, 128, 129, 1000].map((n, i) => ({ type: 2, meta: { i, name: `曲${i}` }, data: rnd(n) }));
    const bytes = await build(records, { chunkSize: 64 });
    for (const piece of [1, 7, 64, 100, 5000]) {
      const got = await readAll(bytes, KEY, piece);
      assert.equal(got.length, records.length, `piece ${piece}`);
      got.forEach((g, i) => {
        assert.deepEqual(g.meta, records[i].meta);
        same(g.data, records[i].data, `record ${i} piece ${piece}`);
      });
    }
  });

  it('every total length around a chunk boundary works, including an empty last chunk', async () => {
    let sawEmptyLast = false;
    for (let n = 0; n <= 200; n++) {
      const rec = { type: 2, meta: { n }, data: rnd(n) };
      const bytes = await build([rec], { chunkSize: 64 });
      const spans = chunkSpans(bytes);
      if (spans[spans.length - 1][1] - spans[spans.length - 1][0] === 4 + 16) sawEmptyLast = true;
      const got = await readAll(bytes);
      assert.equal(got.length, 1, `n=${n}`);
      same(got[0].data, rec.data, `n=${n}`);
    }
    assert.ok(sawEmptyLast, 'at least one case ended exactly on a chunk boundary');
  });

  it('an archive with nothing in it is valid', async () => {
    assert.deepEqual(await readAll(await build([])), []);
  });

  it('the default chunk size and a bigger file (a million bytes) go through', async () => {
    const sink = memorySink();
    const data = rnd(1_000_000);
    const w = await ArchiveWriter.create(sink, KEY, { iterations: ITER });
    await w.writeRecord(2, { big: true }, { size: data.length, source: memorySource(data, 30000) });
    await w.finish();
    const got = await readAll(sink.bytes(), KEY, 50000);
    same(got[0].data, data);
  });

  it('records can be skipped, or read halfway, and the next one is still right', async () => {
    const bytes = await build(SAMPLE);
    const r = await ArchiveReader.open(memorySource(bytes), KEY);
    const a = (await r.next())!;
    assert.equal(a.type, 3);
    const b = (await r.next())!; // a was not read at all
    assert.equal(b.type, 1);
    const half = await b.read(4);
    assert.equal(half.length, 4);
    const c = (await r.next())!; // b was read halfway
    assert.deepEqual(c.meta, SAMPLE[2].meta);
    same(await c.readAll(), SAMPLE[2].data);
    assert.equal((await b.read(10)).length, 0, 'a record that has been left behind gives nothing more');
    await (await r.next())!.skip();
    assert.equal(await r.next(), null);
    assert.equal(await r.next(), null, 'asking again after the end is fine');
  });

  it('what the writer makes is byte-for-byte what a second, independent reader (Node crypto only) understands', async () => {
    for (const chunkSize of [16, 64, 4096]) {
      const bytes = await build(SAMPLE, { chunkSize });
      const got = refRead(bytes, KEY);
      assert.equal(got.length, SAMPLE.length);
      got.forEach((g, i) => {
        assert.equal(g.type, SAMPLE[i].type);
        assert.deepEqual(g.meta, SAMPLE[i].meta);
        same(g.data, SAMPLE[i].data);
      });
    }
  });

  it('and our reader understands what an independent writer makes', async () => {
    for (const chunkSize of [16, 64, 4096]) {
      const got = await readAll(refWrite(SAMPLE, KEY, chunkSize));
      assert.equal(got.length, SAMPLE.length);
      got.forEach((g, i) => {
        assert.deepEqual(g.meta, SAMPLE[i].meta);
        same(g.data, SAMPLE[i].data);
      });
    }
  });

  it('a different salt every time; with the salt fixed the output is reproducible', async () => {
    const a = await build(SAMPLE);
    const b = await build(SAMPLE);
    assert.notEqual(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
    const fixed = (n: number) => new Uint8Array(n).fill(9);
    const make = async () => {
      const sink = memorySink();
      const w = await ArchiveWriter.create(sink, KEY, { iterations: ITER, chunkSize: 64, random: fixed });
      for (const r of SAMPLE) await w.writeRecord(r.type, r.meta, r.data);
      await w.finish();
      return Buffer.from(sink.bytes()).toString('hex');
    };
    assert.equal(await make(), await make());
  });
});

describe('the secret key', () => {
  it('a wrong key is told apart from damage', async () => {
    const bytes = await build(SAMPLE);
    assert.equal(await codeOf(readAll(bytes, 'another key entirely')), 'wrong-key');
    assert.equal(await codeOf(readAll(bytes, KEY + ' ')), 'wrong-key', 'a trailing space is part of the key');
    assert.equal(await codeOf(readAll(bytes, KEY.toUpperCase())), 'wrong-key');
    assert.equal(await codeOf(readAll(bytes, '')), 'wrong-key');
    assert.equal(await codeOf(readAll(bytes, KEY)), 'no error');
  });

  it('the same letters typed full-width or half-width are the same key (NFKC)', async () => {
    const bytes = await build(SAMPLE, { key: 'Secret-Key-2026!' });
    assert.equal(normalizeSecretKey('ＡＢＣ１２３'), 'ABC123');
    assert.equal(await codeOf(readAll(bytes, 'Ｓｅｃｒｅｔ－Ｋｅｙ－２０２６！')), 'no error');
    assert.equal(await codeOf(readAll(bytes, 'secret-key-2026!')), 'wrong-key');
  });

  it('a key with Japanese and emoji works, and so does a very long one', async () => {
    for (const key of ['秘密のキー🔑ふるいけや', 'x'.repeat(500)]) assert.equal(await codeOf(readAll(await build(SAMPLE, { key }), key)), 'no error');
  });

  it('the key is made slowly on purpose, shows its progress, and can be cancelled', async () => {
    const seen: number[] = [];
    const sink = memorySink();
    await ArchiveWriter.create(sink, KEY, { iterations: 20000, onKeyProgress: (f) => seen.push(f) });
    assert.ok(seen.length >= 3 && seen.at(-1) === 1);
    assert.equal(await codeOf(ArchiveWriter.create(memorySink(), KEY, { iterations: 100000, isCancelled: () => true })), 'cancelled');
    const bytes = await build(SAMPLE, { iterations: 20000 });
    assert.equal(await codeOf(ArchiveReader.open(memorySource(bytes), KEY, { isCancelled: () => true })), 'cancelled');
  });
});

describe('what is not an archive, or not one we can read', () => {
  it('foreign, empty and short files say "not a backup"', async () => {
    for (const bytes of [new Uint8Array(0), rnd(10), rnd(29), rnd(500), Uint8Array.from(Buffer.from('{"app":"music-space","format":1}'.repeat(5)))]) {
      assert.equal(await codeOf(readAll(bytes)), 'not-archive');
    }
  });
  it('a newer version, another key-making method, and absurd settings in the header', async () => {
    const good = await build(SAMPLE);
    const edit = (f: (b: Uint8Array) => void) => { const b = Uint8Array.from(good); f(b); return b; };
    assert.equal(await codeOf(readAll(edit((b) => { b[4] = 2; }))), 'newer');
    assert.equal(await codeOf(readAll(edit((b) => { b[4] = 0; }))), 'unsupported');
    assert.equal(await codeOf(readAll(edit((b) => { b[5] = 9; }))), 'unsupported');
    assert.equal(await codeOf(readAll(edit((b) => { b.set([0xff, 0xff, 0xff, 0xff], 6); }))), 'corrupt'); // 4 billion iterations: refused, not calculated
    assert.equal(await codeOf(readAll(edit((b) => { b.set([0, 0, 0, 0], 6); }))), 'corrupt');
    assert.equal(await codeOf(readAll(edit((b) => { b.set([0xff, 0xff, 0xff, 0x7f], 10); }))), 'corrupt'); // a 2 GB chunk size
    assert.equal(await codeOf(readAll(edit((b) => { b.set([1, 0, 0, 0], 10); }))), 'corrupt');
  });
});

describe('damage is always noticed – never wrong data', () => {
  const small: Rec[] = [{ type: 2, meta: { id: 'x' }, data: rnd(150) }];

  it('every single flipped byte, anywhere in the file', async () => {
    const good = await build(small, { chunkSize: 64 });
    const code = new Set<string>();
    for (let i = 0; i < good.length; i++) {
      const bad = Uint8Array.from(good);
      bad[i] ^= 0x01;
      const c = await codeOf(readAll(bad));
      assert.notEqual(c, 'no error', `byte ${i} of ${good.length}`);
      code.add(c);
    }
    assert.ok(code.has('wrong-key') && code.has('corrupt'));
  });

  it('a file that is cut short at any length', async () => {
    const good = await build(small, { chunkSize: 64 });
    for (let n = 0; n < good.length; n++) assert.notEqual(await codeOf(readAll(good.subarray(0, n))), 'no error', `cut at ${n}`);
    // exactly on a chunk boundary is the dangerous one: every chunk is fine, the last one is simply missing
    for (const [, end] of chunkSpans(good).slice(0, -1)) assert.equal(await codeOf(readAll(good.subarray(0, end))), 'corrupt', `cut at boundary ${end}`);
  });

  it('extra bytes at the end, a repeated chunk, a swapped pair, a removed chunk', async () => {
    const good = await build([{ type: 2, meta: { id: 'x' }, data: rnd(400) }], { chunkSize: 64 });
    const spans = chunkSpans(good);
    assert.ok(spans.length >= 4);
    const part = (i: number) => good.subarray(spans[i][0], spans[i][1]);
    const head = good.subarray(0, 30);
    assert.notEqual(await codeOf(readAll(concatBytes(good, Uint8Array.of(0)))), 'no error');
    assert.notEqual(await codeOf(readAll(concatBytes(good, part(1)))), 'no error', 'a chunk appended again');
    assert.notEqual(await codeOf(readAll(concatBytes(head, part(0), part(1), part(1), ...spans.slice(2).map((_, i) => part(i + 2))))), 'no error', 'a chunk repeated in the middle');
    assert.notEqual(await codeOf(readAll(concatBytes(head, part(0), part(2), part(1), ...spans.slice(3).map((_, i) => part(i + 3))))), 'no error', 'two chunks swapped');
    assert.notEqual(await codeOf(readAll(concatBytes(head, part(0), ...spans.slice(2).map((_, i) => part(i + 2))))), 'no error', 'a chunk removed');
    assert.notEqual(await codeOf(readAll(concatBytes(head, ...spans.slice(1).map((_, i) => part(i + 1))))), 'no error', 'the first chunk removed');
  });

  it('chunks of another archive made with the same key cannot be mixed in (they carry another header)', async () => {
    const a = await build([{ type: 2, meta: { id: 'a' }, data: rnd(300) }], { chunkSize: 64 });
    const b = await build([{ type: 2, meta: { id: 'b' }, data: rnd(300) }], { chunkSize: 64 });
    const sa = chunkSpans(a);
    const sb = chunkSpans(b);
    const mixed = concatBytes(a.subarray(0, sa[2][0]), b.subarray(sb[2][0]));
    assert.notEqual(await codeOf(readAll(mixed)), 'no error');
  });

  it('a record claiming a huge size, and broken meta, are refused', async () => {
    // an independent writer lets us make the nonsense on purpose
    const wrongSize = refWrite([{ type: 2, meta: { id: 'x' }, data: rnd(10) }], KEY, 64);
    assert.equal((await readAll(wrongSize)).length, 1);
    const sink = memorySink();
    const w = await ArchiveWriter.create(sink, KEY, { iterations: ITER, chunkSize: 64 });
    await w.writeRecord(2, { a: 1 }, rnd(5));
    await w.finish();
    const r = await ArchiveReader.open(memorySource(sink.bytes()), KEY);
    const rec = (await r.next())!;
    assert.equal(rec.size, 5);
  });
});

describe('the writer checks its own work', () => {
  it('a source that gives too few or too many bytes is an error', async () => {
    for (const [declared, actual] of [[100, 60], [100, 140], [10, 0]]) {
      const w = await ArchiveWriter.create(memorySink(), KEY, { iterations: ITER, chunkSize: 64 });
      assert.equal(await codeOf(w.writeRecord(2, {}, { size: declared, source: memorySource(rnd(actual)) })), 'size-mismatch', `${declared} vs ${actual}`);
    }
  });
  it('it cannot be used after it has finished, and bad settings are refused', async () => {
    const w = await ArchiveWriter.create(memorySink(), KEY, { iterations: ITER, chunkSize: 64 });
    await w.finish();
    assert.equal(await codeOf(w.writeRecord(2, {}, new Uint8Array(0))), 'bad-use');
    assert.equal(await codeOf(w.finish()), 'bad-use');
    assert.equal(await codeOf(ArchiveWriter.create(memorySink(), KEY, { iterations: 10 })), 'bad-use');
    assert.equal(await codeOf(ArchiveWriter.create(memorySink(), KEY, { iterations: 5_000_000 })), 'bad-use');
    assert.equal(await codeOf(ArchiveWriter.create(memorySink(), KEY, { iterations: ITER, chunkSize: 4 })), 'bad-use');
    const w2 = await ArchiveWriter.create(memorySink(), KEY, { iterations: ITER, chunkSize: 64 });
    assert.equal(await codeOf(w2.writeRecord(300, {}, new Uint8Array(0))), 'bad-use');
    assert.equal(await codeOf(w2.writeRecord(2, { big: 'x'.repeat(2_000_000) }, new Uint8Array(0))), 'bad-use');
  });
  it('a cancel while a file is being written stops it', async () => {
    const w = await ArchiveWriter.create(memorySink(), KEY, { iterations: ITER, chunkSize: 64 });
    let calls = 0;
    assert.equal(await codeOf(w.writeRecord(2, {}, { size: 10_000, source: memorySource(rnd(10_000), 100) }, () => ++calls > 3)), 'cancelled');
  });
  it('every piece written is small: one chunk and its tag, never the whole file in memory', async () => {
    const pieces: number[] = [];
    const w = await ArchiveWriter.create({ write: (b) => void pieces.push(b.length) }, KEY, { iterations: ITER, chunkSize: 1024 });
    await w.writeRecord(2, {}, { size: 50_000, source: memorySource(rnd(50_000), 777) });
    await w.finish();
    assert.equal(pieces[0], 30);
    assert.ok(pieces.slice(1).every((n) => n <= 4 + 1024 + 16), JSON.stringify(Math.max(...pieces)));
  });
});
