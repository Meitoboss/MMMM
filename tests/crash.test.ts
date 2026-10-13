import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { type CrashRecord, canStayOpenAfterFatal, clearLastCrash, crashText, installCrashRecorder, installSafeMode, localStamp, onFatalError, readLastCrash, recordCrash, setCrashStorage, setStayOpenCheck, shouldShowSafeScreen, toRecord, validRecord } from '../src/crash';

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

const fatal = (over: Partial<CrashRecord> = {}): CrashRecord => ({ at: '2026-10-10T10:33:32.000Z', fatal: true, message: 'undefined is not a function', stack: 'at Home (app/(tabs)/index.tsx:42)', ...over });

describe('the screen after a fatal error', () => {
  beforeEach(() => setCrashStorage(memoryStorage()));
  afterEach(() => setCrashStorage(null));

  it('a stored record is checked; anything that is not a record is "no record"', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { message: 'm' }, { ...fatal(), fatal: 'yes' }, { ...fatal(), stack: 5 }, { ...fatal(), at: 0 }]) assert.equal(validRecord(bad), null, JSON.stringify(bad));
    assert.deepEqual(validRecord(fatal()), fatal());
    assert.equal(validRecord(fatal({ message: 'x'.repeat(5000) }))!.message.length, 2000);
    assert.equal(validRecord(fatal({ stack: 'x'.repeat(9000) }))!.stack.length, 4000);
    assert.equal(validRecord({ ...fatal(), info: 5 })!.info, undefined);
    assert.equal(validRecord({ ...fatal(), info: 'updates: off' })!.info, 'updates: off');
  });

  it('a damaged record in storage does not stop the app from starting', () => {
    setCrashStorage({ get: () => '{ this is not json', set: () => undefined, del: () => undefined });
    assert.equal(readLastCrash(), null);
    setCrashStorage({ get: () => JSON.stringify({ message: 5 }), set: () => undefined, del: () => undefined });
    assert.equal(readLastCrash(), null);
  });

  it('only a fatal error gets a screen of its own', () => {
    assert.ok(shouldShowSafeScreen(fatal()));
    assert.ok(!shouldShowSafeScreen(fatal({ fatal: false })));
    assert.ok(!shouldShowSafeScreen(null));
  });

  it('the shared text has the time (the phone\'s own), how the app was running, the message and the stack', () => {
    const t = crashText(fatal({ info: 'updates: on · built-in version · runtime 1' }));
    const lines = t.split('\n');
    assert.equal(lines[0], 'Music space: 前回の異常終了');
    assert.match(lines[1], /^時刻: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.equal(lines[2], '実行: updates: on · built-in version · runtime 1');
    assert.ok(t.includes('undefined is not a function') && t.includes('app/(tabs)/index.tsx:42'));
    assert.match(crashText(fatal({ fatal: false })), /致命的ではないエラー/);
    assert.ok(!crashText(fatal()).includes('実行:'), 'no line when nothing is known');
    assert.equal(localStamp('not a date'), 'not a date');
  });

  it('a recorded error says how the app was running, when that can be found out (and never fails when it cannot)', () => {
    recordCrash(new Error('x'), true);
    const r = readLastCrash();
    assert.equal(r?.message, 'x');
    assert.ok(r?.info === undefined || typeof r.info === 'string');
  });

  describe('installSafeMode', () => {
    /** a registry like React Native's: it remembers what was registered, and which provider */
    const registry = () => {
      const seen: { name: string; provider: () => unknown }[] = [];
      const r = { registerComponent(name: string, provider: () => unknown) { seen.push({ name, provider }); return name; } };
      return { r, seen };
    };

    it('with no record, or only a small one, the root is still wrapped (so that a fatal error DURING the run can be shown)', () => {
      for (const rec of [null, fatal({ fatal: false })]) {
        setCrashStorage(memoryStorage());
        if (rec) setCrashStorage({ get: () => JSON.stringify(rec), set: () => undefined, del: () => undefined });
        const { r, seen } = registry();
        const original = r.registerComponent;
        installSafeMode({ AppRegistry: r });
        const provider = () => 'APP';
        r.registerComponent('main', provider);
        assert.notEqual(seen[0].provider, provider, 'wrapped');
        assert.equal(r.registerComponent, original, 'and put back at once');
      }
    });

    it('after a fatal error, the root of the app is wrapped – once, only for "main"', () => {
      setCrashStorage({ get: () => JSON.stringify(fatal()), set: () => undefined, del: () => undefined });
      const { r, seen } = registry();
      const original = r.registerComponent;
      installSafeMode({ AppRegistry: r });
      assert.notEqual(r.registerComponent, original);
      const other = () => 'OTHER';
      r.registerComponent('something else', other);
      assert.equal(seen[0].provider, other, 'another component is left alone');
      assert.equal(r.registerComponent === original, false, 'still waiting for "main"');
      const app = () => 'APP';
      r.registerComponent('main', app);
      assert.notEqual(seen[1].provider, app, 'the root is wrapped');
      assert.equal(r.registerComponent, original, 'and the registry is put back at once');
      r.registerComponent('main', app);
      assert.equal(seen[2].provider, app, 'a second registration is not wrapped again');
    });

    it('can be undone before the app is registered (when the app could not even load)', () => {
      setCrashStorage({ get: () => JSON.stringify(fatal()), set: () => undefined, del: () => undefined });
      const { r, seen } = registry();
      const original = r.registerComponent;
      const undo = installSafeMode({ AppRegistry: r });
      undo();
      assert.equal(r.registerComponent, original);
      const app = () => 'APP';
      r.registerComponent('main', app);
      assert.equal(seen[0].provider, app);
    });

    it('where there is no registry (or it cannot be found), nothing happens and nothing throws', () => {
      setCrashStorage({ get: () => JSON.stringify(fatal()), set: () => undefined, del: () => undefined });
      assert.doesNotThrow(() => installSafeMode({}));
      assert.equal(typeof installSafeMode({}), 'function');
    });
  });
});

describe('a fatal error during the run', () => {
  const g = globalThis as { ErrorUtils?: unknown };
  const original = g.ErrorUtils;
  let installed: ((e: unknown, fatal?: boolean) => void) | undefined;
  let calls: string[];
  const stops: (() => void)[] = [];
  beforeEach(() => {
    setCrashStorage(memoryStorage());
    calls = [];
    g.ErrorUtils = { getGlobalHandler: () => (e: unknown) => calls.push(`original:${(e as Error).message}`), setGlobalHandler: (h: typeof installed) => { installed = h; } };
    installCrashRecorder();
  });
  afterEach(() => {
    g.ErrorUtils = original;
    setCrashStorage(null);
    setStayOpenCheck(null);
    while (stops.length) stops.pop()!();
  });
  const listen = (fn: (r: CrashRecord) => void) => { stops.push(onFatalError(fn)); };

  it('nothing for expo-updates to fall back to: the error is shown at once and the app is NOT closed (the original handler is not called)', () => {
    setStayOpenCheck(() => true);
    const shown: CrashRecord[] = [];
    listen((r) => shown.push(r));
    installed!(new Error('boom'), true);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].message, 'boom');
    assert.equal(shown[0].fatal, true);
    assert.deepEqual(calls, [], 'the app stays open');
    assert.equal(readLastCrash()?.message, 'boom', 'and it is written down as well');
  });

  it('an update is running: the error must reach expo-updates (it starts the built-in version), so the original handler is called', () => {
    setStayOpenCheck(() => false);
    const shown: CrashRecord[] = [];
    listen((r) => shown.push(r));
    installed!(new Error('bad update'), true);
    assert.deepEqual(shown, []);
    assert.deepEqual(calls, ['original:bad update']);
    assert.equal(readLastCrash()?.message, 'bad update', 'written down first, shown at the next start');
  });

  it('small errors never take over the screen; the original handler is called', () => {
    setStayOpenCheck(() => true);
    const shown: CrashRecord[] = [];
    listen((r) => shown.push(r));
    installed!(new Error('small'), false);
    assert.deepEqual(shown, []);
    assert.deepEqual(calls, ['original:small']);
  });

  it('with no screen listening, the app is never kept open (there would be nothing to show): the original handler is called', () => {
    setStayOpenCheck(() => true);
    installed!(new Error('nobody listens'), true);
    assert.deepEqual(calls, ['original:nobody listens']);
  });

  it('a screen that cannot be shown: the normal way is used', () => {
    setStayOpenCheck(() => true);
    listen(() => { throw new Error('the screen is broken'); });
    installed!(new Error('boom'), true);
    assert.deepEqual(calls, ['original:boom']);
  });

  it('stopping to listen is possible; and a failing storage does not stop the error from being shown', () => {
    setStayOpenCheck(() => true);
    const shown: string[] = [];
    const stop = onFatalError((r) => shown.push(r.message));
    stop();
    installed!(new Error('after stop'), true);
    assert.deepEqual(shown, []);
    assert.deepEqual(calls, ['original:after stop']);
    // storage fails: there is no record, so the screen cannot be given one – the normal way is used
    calls.length = 0;
    setCrashStorage({ get: () => null, set: () => { throw new Error('disk'); }, del: () => undefined });
    listen((r) => shown.push(r.message));
    installed!(new Error('no storage'), true);
    assert.deepEqual(calls, ['original:no storage']);
  });

  it('without expo-updates to ask, the app may stay open (nothing can be rolled back)', () => {
    assert.equal(canStayOpenAfterFatal(), true);
  });
});
