import type { ByteSink, ByteSource } from '../core/archive';

/**
 * Reading and writing files for the song archive – written against small interfaces (not against Expo directly), so that the
 * rules (where the end of a file is, what a half-written file does, what "commit" and "abort" leave behind) can be tested.
 * The real implementation is in songArchivePlatform.ts.
 */
export interface FileHandleLike {
  readBytes(length: number): Uint8Array;
  writeBytes(bytes: Uint8Array): void;
  offset: number | null;
  size: number | null;
  close(): void;
}
export interface FileLike {
  exists: boolean;
  create(): void;
  delete(): void;
  open(): FileHandleLike;
}
export interface FsLike {
  file(uri: string): FileLike;
  /** replaces what is at `to` */
  move(from: string, to: string): Promise<void>;
  /** no error when it is not there */
  remove(uri: string): Promise<void>;
  sizeOf(uri: string): Promise<number | null>;
}

/** a file as a stream of bytes (the end is an empty read); the handle stays open until `close` */
export function sourceFromFile(fs: FsLike, uri: string): { source: ByteSource; size: number; close(): void } {
  const handle = fs.file(uri).open();
  const size = handle.size ?? 0;
  let closed = false;
  return {
    size,
    source: {
      read(n) {
        if (closed || handle.offset === null) return new Uint8Array(0);
        const left = size - handle.offset;
        return left <= 0 ? new Uint8Array(0) : handle.readBytes(Math.min(n, left));
      },
    },
    close() {
      if (!closed) {
        closed = true;
        handle.close();
      }
    },
  };
}

/** a new, empty file to write into; an old file of that name is replaced. `abort` closes and deletes it. */
export function sinkToFile(fs: FsLike, uri: string): { sink: ByteSink; close(): void; abort(): Promise<void> } {
  const file = fs.file(uri);
  if (file.exists) file.delete();
  file.create();
  const handle = file.open();
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      handle.close();
    }
  };
  return {
    sink: { write: (bytes) => handle.writeBytes(bytes) },
    close,
    async abort() {
      close();
      await fs.remove(uri);
    },
  };
}

/** the operations on the saved songs' folder that `exportSongArchive` and `restoreSongArchive` need */
export function offlineFileOps(fs: FsLike, dir: string) {
  return {
    fileSize: (fileName: string) => fs.sizeOf(`${dir}${fileName}`),
    async openFile(fileName: string) {
      const f = sourceFromFile(fs, `${dir}${fileName}`);
      return { source: f.source, close: f.close };
    },
    /** nothing is visible under `fileName` until `commit`; `abort` leaves nothing (also after `commit`) */
    async beginFile(fileName: string) {
      const part = `${dir}${fileName}.part`;
      const final = `${dir}${fileName}`;
      await fs.remove(part);
      const out = sinkToFile(fs, part);
      let committed = false;
      return {
        sink: out.sink,
        async commit() {
          out.close();
          await fs.move(part, final);
          committed = true;
        },
        async abort() {
          out.close();
          await fs.remove(part);
          if (committed) await fs.remove(final);
        },
      };
    },
  };
}
