import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { clearLastCrash, installCrashRecorder, readLastCrash, recordCrash, setCrashStorage, toRecord } from '../src/crash';

function memoryStorage() {
  let v: string | null = null;
  return { get: () => v, set: (x: string) => void (v = x), del: () => void (v = null) };
}

describe('crash recorder', () => {
  const g = globalThis as { ErrorUtils?: unknown };
  const original = g.ErrorUtils;
  beforeEach(() => setCrashStorage(memoryStorage()));
  afterEach(() => {
    g.ErrorUtils = original;
    setCrashStorage(null);
  });

  it('turns any thrown value into a readable record (and trims the stack)', () => {
    const err = new Error('boom');
    err.stack = Array.from({ length: 40 }, (_, i) => `at fn${i}`).join('\n');
    const r = toRecord(err, true, new Date('2026-10-02T00:00:00Z'));
    assert.equal(r.message, 'boom');
    assert.equal(r.stack.split('\n').length, 14);
    assert.equal(r.at, '2026-10-02T00:00:00.000Z');
    assert.equal(toRecord('plain string', false).message, 'plain string');
    assert.equal(toRecord(undefined, false).message, 'unknown error');
  });

  it('records, reads back and clears', () => {
    assert.equal(readLastCrash(), null);
    recordCrash(new Error('x'), true);
    const c = readLastCrash();
    assert.equal(c?.message, 'x');
    assert.equal(c?.fatal, true);
    clearLastCrash();
    assert.equal(readLastCrash(), null);
  });

  it('wraps the global handler: stores the error first, then still calls the original handler', () => {
    const calls: string[] = [];
    let installed: ((e: unknown, fatal?: boolean) => void) | undefined;
    g.ErrorUtils = {
      getGlobalHandler: () => (e: unknown) => calls.push(`original:${(e as Error).message}`),
      setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => { installed = h; },
    };
    installCrashRecorder();
    assert.ok(installed);
    installed!(new Error('fatal one'), true);
    assert.deepEqual(calls, ['original:fatal one']);
    assert.equal(readLastCrash()?.message, 'fatal one');
  });

  it('does nothing (and does not throw) where ErrorUtils does not exist', () => {
    g.ErrorUtils = undefined;
    assert.doesNotThrow(() => installCrashRecorder());
  });

  it('never throws, even when storage fails', () => {
    setCrashStorage({ get: () => { throw new Error('disk'); }, set: () => { throw new Error('disk'); }, del: () => { throw new Error('disk'); } });
    assert.doesNotThrow(() => recordCrash(new Error('x'), true));
    assert.equal(readLastCrash(), null);
    assert.doesNotThrow(() => clearLastCrash());
  });
});
