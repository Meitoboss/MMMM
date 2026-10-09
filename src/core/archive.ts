import { aeadOpen, aeadSeal } from './crypto/chacha20poly1305';
import { concatBytes, readU32le, u32le, utf8Decode, utf8Encode } from './crypto/bytes';
import { randomBytes } from './crypto/random';
import { pbkdf2Sha256 } from './crypto/sha256';

/**
 * The encrypted archive ("MSBX"): a stream of records, cut into chunks that are each sealed with ChaCha20-Poly1305.
 *
 *   header (30 bytes, readable):  "MSBX" · version u8 · kdf u8 (1 = PBKDF2-SHA-256) · iterations u32 · chunk size u32 · salt 16
 *   then chunks:                  length u32 · sealed bytes (ciphertext + 16-byte tag)
 *     key    = PBKDF2-SHA-256(secret key, salt, iterations)
 *     nonce  = 4 zero bytes · chunk number as u64 (the key is new for every archive, so a counter is enough)
 *     aad    = header · chunk number u32 · "is this the last chunk" u8
 *   what the chunks hold (one continuous stream):  records:  type u8 · meta length u32 · meta (JSON) · data length u32 · data
 *
 * Every chunk is checked on its own, the header and the order are part of what is checked, and the last chunk is marked: a wrong
 * key, a changed byte, a missing, repeated or swapped chunk, and a file that was cut short are all noticed.
 * Nothing here knows about files or songs: bytes go in and out through a sink and a source.
 */
export const ARCHIVE_MAGIC = 'MSBX';
export const ARCHIVE_VERSION = 1;
export const KDF_PBKDF2_SHA256 = 1;
export const DEFAULT_ITERATIONS = 100_000;
export const DEFAULT_CHUNK = 64 * 1024;
const MIN_ITERATIONS = 1000;
const MAX_ITERATIONS = 2_000_000; // a file must not be able to make the phone calculate for an hour
const MIN_CHUNK = 16;
const MAX_CHUNK = 1024 * 1024;
const HEADER_LEN = 30;
const TAG = 16;
const MAX_META = 1024 * 1024;
export const REC_END = 0xff;

export type ArchiveErrorCode = 'not-archive' | 'newer' | 'unsupported' | 'wrong-key' | 'corrupt' | 'cancelled' | 'size-mismatch' | 'bad-use';

export class ArchiveError extends Error {
  constructor(readonly code: ArchiveErrorCode, message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}
const MESSAGES: Record<ArchiveErrorCode, string> = {
  'not-archive': 'このファイルは、保存した曲のバックアップではありません',
  newer: '新しい版のアプリで作られたファイルです。アプリを更新してから、もう一度お試しください',
  unsupported: 'このファイルの形式には、対応していません',
  'wrong-key': '秘密のキーが違うか、ファイルが壊れています',
  corrupt: 'ファイルが途中で切れているか、壊れています',
  cancelled: '中止しました',
  'size-mismatch': '書き込み中に、元のファイルの大きさが変わりました',
  'bad-use': '内部の使い方が正しくありません',
};
const fail = (code: ArchiveErrorCode): never => {
  throw new ArchiveError(code, MESSAGES[code]);
};

export interface ByteSink {
  write(bytes: Uint8Array): void | Promise<void>;
}
/** `read(n)` gives up to n bytes; an EMPTY result means the end */
export interface ByteSource {
  read(maxBytes: number): Uint8Array | Promise<Uint8Array>;
}

/** reads from an array in memory (tests, small things) */
export function memorySource(bytes: Uint8Array, maxPiece = Number.MAX_SAFE_INTEGER): ByteSource {
  let o = 0;
  return {
    read(n) {
      const take = Math.min(n, maxPiece, bytes.length - o);
      const out = bytes.subarray(o, o + take);
      o += take;
      return out;
    },
  };
}
export function memorySink(): ByteSink & { bytes(): Uint8Array } {
  const parts: Uint8Array[] = [];
  return { write: (b) => void parts.push(Uint8Array.from(b)), bytes: () => concatBytes(...parts) };
}

/** NFKC, so that the same letters typed on another phone give the same key (skipped where the engine cannot) */
export function normalizeSecretKey(key: string): string {
  try {
    return key.normalize('NFKC');
  } catch {
    return key;
  }
}

export interface KeyOptions {
  onKeyProgress?: (fraction: number) => void;
  isCancelled?: () => boolean;
}

async function deriveKey(secretKey: string, salt: Uint8Array, iterations: number, o: KeyOptions): Promise<Uint8Array> {
  try {
    return await pbkdf2Sha256(utf8Encode(normalizeSecretKey(secretKey)), salt, iterations, 32, { onProgress: o.onKeyProgress, isCancelled: o.isCancelled });
  } catch (e) {
    if (e instanceof Error && e.message === 'cancelled') return fail('cancelled');
    throw e;
  }
}

const nonceFor = (index: number): Uint8Array => {
  const n = new Uint8Array(12);
  n.set(u32le(index >>> 0), 4);
  n.set(u32le(Math.floor(index / 0x100000000)), 8);
  return n;
};
const aadFor = (header: Uint8Array, index: number, final: boolean): Uint8Array => concatBytes(header, u32le(index), Uint8Array.of(final ? 1 : 0));

/* ------------------------------------------------------------------ writing ------------------------------------------------------------------ */
export interface WriterOptions extends KeyOptions {
  iterations?: number;
  chunkSize?: number;
  /** the salt (not secret – it only has to be different every time) */
  random?: (n: number) => Uint8Array;
}

export class ArchiveWriter {
  private buf: Uint8Array;
  private fill = 0;
  private index = 0;
  private finished = false;

  private constructor(private sink: ByteSink, private key: Uint8Array, private header: Uint8Array, private chunkSize: number) {
    this.buf = new Uint8Array(chunkSize);
  }

  static async create(sink: ByteSink, secretKey: string, opts: WriterOptions = {}): Promise<ArchiveWriter> {
    const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
    const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK;
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) fail('bad-use');
    if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK || chunkSize > MAX_CHUNK) fail('bad-use');
    const salt = (opts.random ?? ((n) => randomBytes(n).bytes))(16);
    const header = concatBytes(utf8Encode(ARCHIVE_MAGIC), Uint8Array.of(ARCHIVE_VERSION, KDF_PBKDF2_SHA256), u32le(iterations), u32le(chunkSize), salt);
    const key = await deriveKey(secretKey, salt, iterations, opts);
    await sink.write(header);
    return new ArchiveWriter(sink, key, header, chunkSize);
  }

  private async flush(final: boolean): Promise<void> {
    const sealed = aeadSeal(this.key, nonceFor(this.index), aadFor(this.header, this.index, final), this.buf.subarray(0, this.fill));
    this.index++;
    this.fill = 0;
    await this.sink.write(concatBytes(u32le(sealed.length), sealed));
  }

  private async put(bytes: Uint8Array): Promise<void> {
    let o = 0;
    while (o < bytes.length) {
      const take = Math.min(this.chunkSize - this.fill, bytes.length - o);
      this.buf.set(bytes.subarray(o, o + take), this.fill);
      this.fill += take;
      o += take;
      if (this.fill === this.chunkSize) await this.flush(false);
    }
  }

  /** `data`: bytes, or a source that will deliver exactly `size` bytes (anything else is an error) */
  async writeRecord(type: number, meta: unknown, data: Uint8Array | { size: number; source: ByteSource; onBytes?: (n: number) => void }, isCancelled?: () => boolean): Promise<void> {
    if (this.finished) fail('bad-use');
    const m = utf8Encode(JSON.stringify(meta ?? {}));
    const size = data instanceof Uint8Array ? data.length : data.size;
    if (m.length > MAX_META || !Number.isInteger(size) || size < 0 || size > 0xffffffff || !Number.isInteger(type) || type < 0 || type > 255) fail('bad-use');
    await this.put(concatBytes(Uint8Array.of(type), u32le(m.length), m, u32le(size)));
    if (data instanceof Uint8Array) {
      await this.put(data);
      return;
    }
    let left = size;
    while (left > 0) {
      if (isCancelled?.()) fail('cancelled');
      const piece = await data.source.read(Math.min(left, this.chunkSize));
      if (piece.length === 0) fail('size-mismatch');
      await this.put(piece);
      left -= piece.length;
      data.onBytes?.(piece.length);
    }
    if ((await data.source.read(1)).length !== 0) fail('size-mismatch'); // more than it said
  }

  /** the end record, then the last chunk (marked as the last) */
  async finish(): Promise<void> {
    if (this.finished) fail('bad-use');
    await this.writeRecord(REC_END, {}, new Uint8Array(0));
    this.finished = true;
    await this.flush(true);
  }
}

/* ------------------------------------------------------------------ reading ------------------------------------------------------------------ */
export interface ArchiveRecord {
  type: number;
  meta: unknown;
  /** the number of data bytes */
  size: number;
  /** up to `max` bytes of the data; empty when all of it has been read */
  read(max: number): Promise<Uint8Array>;
  readAll(): Promise<Uint8Array>;
  skip(): Promise<void>;
}

export class ArchiveReader {
  private plain: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private index = 0;
  private lookahead: Uint8Array | null | undefined; // undefined = not read yet; null = the end of the file
  private ended = false;
  private done = false; // the end record has been read
  private current: { left: number } | null = null;

  private constructor(private source: ByteSource, private key: Uint8Array, private header: Uint8Array) {}

  static async open(source: ByteSource, secretKey: string, opts: KeyOptions = {}): Promise<ArchiveReader> {
    const header = await readUpTo(source, HEADER_LEN); // a file that is shorter, or starts differently, is simply not one of ours
    if (header.length < HEADER_LEN || utf8Decode(header.subarray(0, 4)) !== ARCHIVE_MAGIC) return fail('not-archive');
    if (header[4] > ARCHIVE_VERSION) return fail('newer');
    if (header[4] < 1 || header[5] !== KDF_PBKDF2_SHA256) return fail('unsupported');
    const iterations = readU32le(header, 6);
    const chunkSize = readU32le(header, 10);
    if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS || chunkSize < MIN_CHUNK || chunkSize > MAX_CHUNK) return fail('corrupt');
    const key = await deriveKey(secretKey, header.slice(14, 30), iterations, opts);
    const r = new ArchiveReader(source, key, header);
    r.chunkSize = chunkSize;
    return r;
  }
  private chunkSize = DEFAULT_CHUNK;

  private async sealedChunk(): Promise<Uint8Array | null> {
    const len = await readExactly(this.source, 4, true);
    if (len === null) return null; // a clean end, between two chunks
    const n = readU32le(len, 0);
    if (n < TAG || n > this.chunkSize + TAG) return fail('corrupt');
    return (await readExactly(this.source, n, false)) as Uint8Array;
  }

  /** decrypts the next chunk into `plain`; false at the end */
  private async nextChunk(): Promise<boolean> {
    if (this.ended) return false;
    if (this.lookahead === undefined) this.lookahead = await this.sealedChunk();
    const sealed = this.lookahead;
    if (sealed === null) return fail('corrupt'); // the file ended before the chunk that is marked as the last
    this.lookahead = await this.sealedChunk();
    const final = this.lookahead === null;
    const opened = aeadOpen(this.key, nonceFor(this.index), aadFor(this.header, this.index, final), sealed);
    if (opened === null) {
      if (this.index > 0) return fail('corrupt');
      // the first chunk: a wrong key – or a right key and a file that was cut after the first chunk (it would open as "not the last")
      const cutShort = final && aeadOpen(this.key, nonceFor(0), aadFor(this.header, 0, false), sealed) !== null;
      return fail(cutShort ? 'corrupt' : 'wrong-key');
    }
    this.index++;
    this.plain = opened;
    this.pos = 0;
    if (final) this.ended = true;
    return true;
  }

  /** up to `max` bytes of the stream (empty only at its end) */
  private async take(max: number): Promise<Uint8Array> {
    while (this.pos >= this.plain.length) {
      if (this.ended || !(await this.nextChunk())) return new Uint8Array(0);
    }
    const out = this.plain.subarray(this.pos, this.pos + max);
    this.pos += out.length;
    return out;
  }

  private async exactly(n: number): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let got = 0;
    while (got < n) {
      const p = await this.take(n - got);
      if (p.length === 0) return fail('corrupt');
      parts.push(p);
      got += p.length;
    }
    return parts.length === 1 ? Uint8Array.from(parts[0]) : concatBytes(...parts);
  }

  /** the next record; null after the end record (and only then is the whole file known to be complete and unchanged) */
  async next(): Promise<ArchiveRecord | null> {
    if (this.done) return null;
    if (this.current) {
      while (this.current.left > 0) {
        const p = await this.take(Math.min(this.current.left, this.chunkSize));
        if (p.length === 0) return fail('corrupt');
        this.current.left -= p.length;
      }
      this.current = null;
    }
    const head = await this.exactly(5);
    const type = head[0];
    const metaLen = readU32le(head, 1);
    if (metaLen > MAX_META) return fail('corrupt');
    const metaBytes = await this.exactly(metaLen);
    const size = readU32le(await this.exactly(4), 0);
    if (type === REC_END) {
      if (size !== 0 || (await this.take(1)).length !== 0 || !this.ended || this.lookahead !== null) return fail('corrupt'); // nothing may follow
      this.done = true;
      return null;
    }
    let meta: unknown;
    try {
      meta = JSON.parse(utf8Decode(metaBytes));
    } catch {
      return fail('corrupt');
    }
    const state = { left: size };
    this.current = state;
    const self = this;
    const rec: ArchiveRecord = {
      type,
      meta,
      size,
      async read(max) {
        if (self.current !== state || state.left === 0) return new Uint8Array(0);
        const p = await self.take(Math.min(max, state.left));
        if (p.length === 0) return fail('corrupt');
        state.left -= p.length;
        return p;
      },
      async readAll() {
        const parts: Uint8Array[] = [];
        for (;;) {
          const p = await rec.read(size || 1);
          if (p.length === 0) break;
          parts.push(Uint8Array.from(p));
        }
        return concatBytes(...parts);
      },
      async skip() {
        while ((await rec.read(size || 1)).length > 0) {
          /* read and drop */
        }
      },
    };
    return rec;
  }
}

/** up to `n` bytes (fewer only at the end of the source) */
async function readUpTo(source: ByteSource, n: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let got = 0;
  while (got < n) {
    const p = await source.read(n - got);
    if (p.length === 0) break;
    parts.push(Uint8Array.from(p));
    got += p.length;
  }
  return parts.length === 1 ? parts[0] : concatBytes(...parts);
}

/** exactly `n` bytes; `allowEmptyEnd`: nothing at all is the clean end of the file (null), anything in between is an error */
async function readExactly(source: ByteSource, n: number, allowEmptyEnd: boolean): Promise<Uint8Array | null> {
  const got = await readUpTo(source, n);
  if (got.length === n) return got;
  if (got.length === 0 && allowEmptyEnd) return null;
  return fail('corrupt');
}
