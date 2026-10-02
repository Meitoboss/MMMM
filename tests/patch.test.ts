import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const script = join(process.cwd(), 'scripts/patch-track-player.mjs');
const REL = 'react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt';

function fixture(source?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'rntp-'));
  if (source !== undefined) {
    const file = join(dir, REL);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, source);
  }
  return { dir, file: join(dir, REL) };
}
const run = (dir: string) => execFileSync('node', [script, dir], { encoding: 'utf8' });

const SOURCE = `
    @ReactMethod
    fun getTrack(index: Int, callback: Promise) {
        val track = musicService.tracks[index]
        callback.resolve(Arguments.fromBundle(track.originalItem))
    }
    @ReactMethod
    fun getActiveTrack(callback: Promise) {
        if (musicService.tracks.isEmpty()) callback.resolve(null)
        else callback.resolve(Arguments.fromBundle(musicService.tracks[musicService.getCurrentTrackIndex()].originalItem))
    }
    fun unrelated() = Arguments.fromBundle(someBundle)
`;

describe('react-native-track-player Kotlin 2 patch', () => {
  it('rewrites every originalItem call and leaves other code alone', () => {
    const { dir, file } = fixture(SOURCE);
    assert.match(run(dir), /fixed 2 call/);
    const out = readFileSync(file, 'utf8');
    assert.ok(out.includes('Arguments.fromBundle(track.originalItem ?: android.os.Bundle())'));
    assert.ok(out.includes('originalItem ?: android.os.Bundle())'));
    assert.ok(!/fromBundle\(track\.originalItem\)/.test(out));
    assert.ok(out.includes('Arguments.fromBundle(someBundle)'), 'unrelated call untouched');
  });

  it('is idempotent', () => {
    const { dir, file } = fixture(SOURCE);
    run(dir);
    const once = readFileSync(file, 'utf8');
    assert.match(run(dir), /already patched/);
    assert.equal(readFileSync(file, 'utf8'), once);
  });

  it('does nothing when the library is not installed or already fixed upstream', () => {
    assert.match(run(fixture().dir), /nothing to do/);
    const fixed = fixture('callback.resolve(track.originalItem?.let { Arguments.fromBundle(it) })');
    assert.match(run(fixed.dir), /expected pattern not found/);
    assert.equal(readFileSync(fixed.file, 'utf8'), 'callback.resolve(track.originalItem?.let { Arguments.fromBundle(it) })');
  });
});
