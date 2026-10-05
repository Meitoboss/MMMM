import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';

import { FADE_LOOKAHEAD, HOT_CUE_SLOTS, fadeGain, isCueSlot, planFadeOut, sanitizeTrim } from '../src/core/dj';
import type { SongItem } from '../src/core/types';
import type { Db, SqlValue } from '../src/db/driver';
import * as repo from '../src/db/repo';
import { migrate } from '../src/db/schema';

function nodeDb(): Db {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  let depth = 0;
  return {
    exec: async (sql) => void raw.exec(sql),
    run: async (sql, p: SqlValue[] = []) => {
      const r = raw.prepare(sql).run(...p);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    all: async <T,>(sql: string, p: SqlValue[] = []) => raw.prepare(sql).all(...p) as T[],
    first: async <T,>(sql: string, p: SqlValue[] = []) => (raw.prepare(sql).get(...p) as T | undefined) ?? null,
    transaction: async <T,>(fn: () => Promise<T>) => {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN');
      try {
        const r = await fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
const song = (id: string, durationSec = 200): SongItem => ({ kind: 'song', id, title: `T ${id}`, artists: [{ name: 'A' }], explicit: false, durationSec });

describe('trim', () => {
  it('start, end, or both', () => {
    assert.deepEqual(sanitizeTrim(12, null, 200), { startSec: 12 });
    assert.deepEqual(sanitizeTrim(null, 190, 200), { endSec: 190 });
    assert.deepEqual(sanitizeTrim(12, 190, 200), { startSec: 12, endSec: 190 });
  });
  it('nothing to trim → null', () => {
    assert.equal(sanitizeTrim(null, null, 200), null);
    assert.equal(sanitizeTrim(0, null, 200), null);
    assert.equal(sanitizeTrim(0.3, null, 200), null, 'a start in the first half second trims nothing');
    assert.equal(sanitizeTrim(undefined, 200, 200), null, 'an end at the very end trims nothing');
    assert.equal(sanitizeTrim(Number.NaN, Number.POSITIVE_INFINITY, 200), null);
  });
  it('would leave less than a second → refused', () => {
    assert.equal(sanitizeTrim(100, 100.5, 200), null);
    assert.deepEqual(sanitizeTrim(100, 101, 200), { startSec: 100, endSec: 101 });
    assert.equal(sanitizeTrim(199.5, null, 200), null, 'a start in the last second');
  });
  it('works without a known duration', () => {
    assert.deepEqual(sanitizeTrim(10, 50), { startSec: 10, endSec: 50 });
  });
});

describe('fades', () => {
  it('equal-power curves: full → silent, silent → full, smooth in between', () => {
    assert.equal(fadeGain('out', 0), 1);
    assert.ok(Math.abs(fadeGain('out', 1)) < 1e-9);
    assert.equal(fadeGain('in', 0), 0);
    assert.ok(Math.abs(fadeGain('in', 1) - 1) < 1e-9);
    let prev = 1;
    for (let i = 1; i <= 20; i++) {
      const g = fadeGain('out', i / 20);
      assert.ok(g <= prev, 'never gets louder while fading out');
      prev = g;
    }
    // out and in together keep the power constant: out² + in² = 1
    for (const t of [0.1, 0.3, 0.5, 0.8]) assert.ok(Math.abs(fadeGain('out', t) ** 2 + fadeGain('in', t) ** 2 - 1) < 1e-9);
    assert.equal(fadeGain('out', -3), 1);
    assert.ok(Math.abs(fadeGain('out', 7)) < 1e-9);
  });

  it('plans the fade-out one progress event ahead, so it starts on time', () => {
    assert.equal(planFadeOut(100, 200, 4), null, 'far from the end');
    assert.equal(planFadeOut(200 - 4 - FADE_LOOKAHEAD - 0.01, 200, 4), null, 'one event too early');
    const early = planFadeOut(200 - 5, 200, 4); // 5 s left, fade 4 s → wait 1 s, then ramp 4 s
    assert.deepEqual(early, { startInMs: 1000, durationMs: 4000 });
    const late = planFadeOut(200 - 3, 200, 4); // already inside the fade window: ramp over what is left
    assert.deepEqual(late, { startInMs: 0, durationMs: 3000 });
  });

  it('no fade when off, when the end is already here, or when numbers are broken', () => {
    assert.equal(planFadeOut(195, 200, 0), null);
    assert.equal(planFadeOut(199.9, 200, 4), null);
    assert.equal(planFadeOut(Number.NaN, 200, 4), null);
  });
});

describe('hot cues and trim in the database', () => {
  let db: Db;
  beforeEach(async () => {
    db = nodeDb();
    await migrate(db);
  });

  it('sets, lists (in slot order), moves and deletes cues', async () => {
    await repo.setHotCue(db, song('a'), 3, 45.5, 'サビ');
    await repo.setHotCue(db, song('a'), 0, 12);
    assert.deepEqual(await repo.hotCues(db, 'a'), [{ slot: 0, position: 12, label: undefined }, { slot: 3, position: 45.5, label: 'サビ' }]);
    await repo.setHotCue(db, song('a'), 3, 50); // moving a cue keeps its name
    assert.deepEqual((await repo.hotCues(db, 'a'))[1], { slot: 3, position: 50, label: 'サビ' });
    await repo.setHotCue(db, song('a'), 3, 50, '  '); // an empty name clears it
    assert.equal((await repo.hotCues(db, 'a'))[1].label, undefined);
    await repo.deleteHotCue(db, 'a', 0);
    assert.equal((await repo.hotCues(db, 'a')).length, 1);
    assert.deepEqual(await repo.hotCues(db, 'other'), []);
  });

  it('refuses a wrong slot or position', async () => {
    assert.ok(isCueSlot(0) && isCueSlot(HOT_CUE_SLOTS - 1) && !isCueSlot(HOT_CUE_SLOTS) && !isCueSlot(-1) && !isCueSlot(1.5));
    await assert.rejects(() => repo.setHotCue(db, song('a'), 8, 5), /番号/);
    await assert.rejects(() => repo.setHotCue(db, song('a'), 0, -1), /位置/);
    await assert.rejects(() => repo.setHotCue(db, song('a'), 0, Number.NaN), /位置/);
  });

  it('cues belong to their song only, and go when the song goes', async () => {
    await repo.setHotCue(db, song('a'), 0, 10);
    await repo.setHotCue(db, song('b'), 0, 99);
    assert.equal((await repo.hotCues(db, 'b'))[0].position, 99);
    await db.run('DELETE FROM Song WHERE id = ?', ['a']);
    assert.deepEqual(await repo.hotCues(db, 'a'), []);
    assert.equal((await repo.hotCues(db, 'b')).length, 1);
  });

  it('trim: saved, read back, repaired, and removed', async () => {
    assert.equal(await repo.trimOf(db, 'a'), null);
    assert.deepEqual(await repo.setTrim(db, song('a'), { startSec: 15, endSec: 180 }), { startSec: 15, endSec: 180 });
    assert.deepEqual(await repo.trimOf(db, 'a'), { startSec: 15, endSec: 180 });
    assert.deepEqual(await repo.setTrim(db, song('a'), { startSec: 15 }), { startSec: 15 }, 'replaces the old one');
    assert.deepEqual(await repo.trimOf(db, 'a'), { startSec: 15 });
    assert.equal(await repo.setTrim(db, song('a'), { startSec: 0.1 }), null, 'nothing left: removed');
    assert.equal(await repo.trimOf(db, 'a'), null);
    await repo.setTrim(db, song('b'), { endSec: 100 });
    assert.equal(await repo.setTrim(db, song('b'), null), null);
    assert.equal(await repo.trimOf(db, 'b'), null);
  });

  it('the migration can run again', async () => {
    await repo.setHotCue(db, song('a'), 1, 5);
    await migrate(db);
    assert.equal((await repo.hotCues(db, 'a')).length, 1);
  });
});
