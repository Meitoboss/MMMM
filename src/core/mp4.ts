/** Tiny MP4 inspection helpers used by Settings → Diagnostics (no React Native imports). */

export const hex = (b: ArrayLike<number>): string =>
  Array.from(b as ArrayLike<number> as number[])
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(' ');

export function ascii(b: ArrayLike<number>): string {
  return Array.from(b as ArrayLike<number> as number[])
    .map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.'))
    .join('');
}

/** Top-level MP4 boxes, e.g. "ftyp:24 moov:1530 sidx:1200 moof:… (end of sample)" */
export function listBoxes(buf: Uint8Array): string {
  const out: string[] = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  while (off + 8 <= buf.length && out.length < 14) {
    let size = dv.getUint32(off);
    const type = ascii(buf.slice(off + 4, off + 8));
    if (size === 1 && off + 16 <= buf.length) size = dv.getUint32(off + 8) * 4294967296 + dv.getUint32(off + 12);
    out.push(`${type}:${size}`);
    if (size < 8) break;
    off += size;
  }
  return out.join(' ') + (off >= buf.length ? ' (end of sample)' : '');
}

/** Sample entry type (mp4a, Opus, …) and the bytes after "esds" (the descriptor shows the AAC object type). */
export function codecInfo(buf: Uint8Array): string {
  const find = (needle: string) => {
    const n = Array.from(needle).map((c) => c.charCodeAt(0));
    for (let i = 0; i + n.length <= buf.length; i++) if (n.every((v, k) => buf[i + k] === v)) return i;
    return -1;
  };
  const stsd = find('stsd');
  // 'stsd' fourcc, version/flags (4), entry_count (4), first entry: size (4) + type (4)
  const entry = stsd >= 0 ? ascii(buf.slice(stsd + 16, stsd + 20)) : 'no stsd in sample';
  const esds = find('esds');
  return `entry=${entry} ${esds >= 0 ? `esds=${hex(buf.slice(esds + 4, esds + 40))}` : 'no esds'}`;
}
