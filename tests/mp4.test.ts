import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codecInfo, hex, listBoxes } from '../src/core/mp4';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const str = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
const box = (type: string, payload: number[] = []) => [...be32(8 + payload.length), ...str(type), ...payload];

describe('mp4 helpers', () => {
  it('lists top-level boxes', () => {
    const buf = Uint8Array.from([...box('ftyp', str('dash....')), ...box('moov', new Array(20).fill(0)), ...box('sidx', new Array(4).fill(1))]);
    assert.equal(listBoxes(buf), 'ftyp:16 moov:28 sidx:12 (end of sample)');
  });
  it('stops at a box that extends past the sample', () => {
    const buf = Uint8Array.from([...box('ftyp', str('dash....')), ...be32(5000), ...str('moov'), 0, 0]);
    assert.equal(listBoxes(buf), 'ftyp:16 moov:5000 (end of sample)');
  });
  it('handles 64-bit sizes and never loops on garbage', () => {
    const big = Uint8Array.from([...be32(1), ...str('mdat'), 0, 0, 0, 1, 0, 0, 0, 0]);
    assert.equal(listBoxes(big), 'mdat:4294967296 (end of sample)');
    assert.equal(listBoxes(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0])), '\u0000\u0000\u0000\u0000'.replace(/./g, '.') + ':0');
  });
  it('reports codec entry and esds bytes', () => {
    const buf = Uint8Array.from([0, 0, 0, 0, ...str('stsd'), 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 40, ...str('mp4a'), ...new Array(30).fill(0), ...str('esds'), 0, 3, 128, 128, 128, 34, 0, 0, 0, 4]);
    const info = codecInfo(buf);
    assert.match(info, /entry=mp4a/);
    assert.match(info, /esds=00 03 80 80 80 22/);
    assert.equal(hex([1, 255]), '01 ff');
  });
});
