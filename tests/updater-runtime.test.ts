import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type UpdatesApi, Updater, type UpdaterState } from '../src/core/updaterRuntime';
import { type ApplyMode, RELOAD_TIMEOUT_MS, SWITCH_DELAY_MS, type Situation, WAIT_POLL_MS } from '../src/core/updater';

/** a world with a fake clock, a fake expo-updates, and the situation (music / jobs) under the test's control */
function world(over: { mode?: ApplyMode; enabled?: boolean } = {}) {
  const w = {
    now: 1_000_000,
    timers: [] as { at: number; fn: () => void; off: boolean }[],
    mode: (over.mode ?? 'ask') as ApplyMode,
    sit: { playing: false, working: false } as Situation,
    server: { available: false, id: 'u1', note: '新機能' as string | null, rollback: false },
    calls: [] as string[],
    bad: new Set<string>(),
    attempts: [] as string[],
    states: [] as UpdaterState[],
    reloadImpl: async () => {},
    checkImpl: null as null | (() => Promise<never>),
    fetchImpl: null as null | (() => Promise<never>),
    gate: null as null | Promise<void>,
    enabled: over.enabled ?? true,
  };
  const updates: UpdatesApi = {
    get isEnabled() { return w.enabled; },
    async checkForUpdateAsync() {
      w.calls.push('check');
      if (w.gate) await w.gate;
      if (w.checkImpl) return w.checkImpl();
      return { isAvailable: w.server.available, isRollBackToEmbedded: w.server.rollback, manifest: w.server.available ? { id: w.server.id, extra: w.server.note === null ? {} : { releaseNote: w.server.note } } : undefined };
    },
    async fetchUpdateAsync() {
      w.calls.push('fetch');
      if (w.fetchImpl) return w.fetchImpl();
      return { isNew: true, isRollBackToEmbedded: w.server.rollback, manifest: { id: w.server.id, extra: w.server.note === null ? {} : { releaseNote: w.server.note } } };
    },
    async reloadAsync() {
      w.calls.push('reload');
      await w.reloadImpl();
    },
  };
  const u = new Updater({
    updates,
    mode: () => w.mode,
    situation: () => w.sit,
    now: () => w.now,
    schedule: (fn, ms) => {
      const t = { at: w.now + ms, fn, off: false };
      w.timers.push(t);
      return () => { t.off = true; };
    },
    onChange: (s) => w.states.push(s),
    isBad: (id) => w.bad.has(id),
    markAttempt: (id) => w.attempts.push(id),
  });
  /** moves the clock, running what is due (and what that schedules) */
  const advance = async (ms: number) => {
    const end = w.now + ms;
    for (;;) {
      const due = w.timers.filter((t) => !t.off && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      w.now = Math.max(w.now, due.at);
      due.off = true;
      due.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    w.now = end;
    await Promise.resolve();
  };
  return { w, u, advance, count: (c: string) => w.calls.filter((x) => x === c).length };
}

describe('looking and downloading', () => {
  it('updates off: nothing is called', async () => {
    const { w, u } = world({ enabled: false });
    assert.equal(await u.check('start'), 'skipped');
    assert.deepEqual(w.calls, []);
  });
  it('nothing new: says so, remembers when it looked, shows nothing', async () => {
    const { w, u } = world();
    assert.equal(await u.check('start'), 'none');
    assert.deepEqual(w.calls, ['check']);
    assert.equal(u.state.phase, 'idle');
    assert.equal(u.state.lastCheckAt, 1_000_000);
    assert.equal(u.state.pending, null);
    assert.equal(u.state.prompt, null);
  });
  it('a new version is downloaded; its note comes from the manifest, cleaned', async () => {
    const { w, u } = world();
    w.server = { available: true, id: 'u2', note: '  検索が\u0000速くなりました \n\n\n\nBPMも ', rollback: false };
    assert.equal(await u.check('start'), 'downloaded');
    assert.deepEqual(w.calls, ['check', 'fetch']);
    assert.deepEqual(u.state.pending, { id: 'u2', note: '検索が速くなりました \n\nBPMも' });
  });
  it('the phase goes checking → downloading → idle', async () => {
    const { w, u } = world({ mode: 'manual' });
    w.server.available = true;
    await u.check('start');
    assert.deepEqual([...new Set(w.states.map((s) => s.phase))], ['checking', 'downloading', 'idle']);
  });
  it('a failing look or download is a quiet failure: the reason is kept, the app goes on, the next look works', async () => {
    const { w, u } = world();
    w.checkImpl = async () => { throw new Error('network down'); };
    assert.equal(await u.check('manual'), 'error');
    assert.equal(u.state.lastError, 'network down');
    assert.equal(u.state.phase, 'idle');
    w.checkImpl = null;
    w.server.available = true;
    w.fetchImpl = async () => { throw new Error('disk full'); };
    assert.equal(await u.check('manual'), 'error');
    assert.equal(u.state.lastError, 'disk full');
    w.fetchImpl = null;
    assert.equal(await u.check('manual'), 'downloaded');
    assert.equal(u.state.lastError, null);
  });
  it('two looks at once: the second is skipped; looking again soon (coming back to the app) is skipped too', async () => {
    const { w, u } = world();
    let open!: () => void;
    w.gate = new Promise((r) => (open = r));
    const first = u.check('start');
    assert.equal(await u.check('manual'), 'skipped');
    open();
    assert.equal(await first, 'none');
    assert.equal(await u.check('foreground'), 'skipped', 'it looked a moment ago');
    w.now += 11 * 60_000;
    assert.equal(await u.check('foreground'), 'none');
  });
  it('a version that is waiting is not looked for again (except by hand)', async () => {
    const { w, u } = world({ mode: 'manual' });
    w.server.available = true;
    await u.check('start');
    w.now += 2 * 3600_000;
    assert.equal(await u.check('tick'), 'skipped');
    assert.equal(await u.check('manual'), 'downloaded');
  });
  it('going back to the version inside the app (a roll-back) is handled like an update', async () => {
    const { w, u } = world({ mode: 'manual' });
    w.server = { available: false, id: 'x', note: null, rollback: true };
    assert.equal(await u.check('start'), 'downloaded');
    assert.deepEqual(u.state.pending, { id: 'rollback', note: 'アプリに入っている版へ、戻します' });
  });
});

describe('ask (the default)', () => {
  it('a pop-up is asked for, once per version, and says whether music is playing', async () => {
    const { w, u } = world();
    w.server.available = true;
    w.sit.playing = true;
    await u.check('start');
    assert.deepEqual(u.state.prompt, { id: 'u1', note: '新機能', playing: true });
    assert.equal(w.states.filter((s) => s.prompt).length >= 1, true);
  });
  it('"later": the pop-up goes, the version stays waiting, and it is not asked about again – a NEWER version is', async () => {
    const { w, u } = world();
    w.server.available = true;
    await u.check('start');
    u.later();
    assert.equal(u.state.prompt, null);
    assert.equal(u.state.pending?.id, 'u1');
    u.reevaluate();
    u.observePending({ id: 'u1', note: null });
    assert.equal(u.state.prompt, null, 'still no second question');
    w.server.id = 'u2';
    await u.check('manual');
    assert.equal(u.state.prompt?.id, 'u2');
  });
  it('"apply now": the switching screen first, the reload a moment later, exactly once', async () => {
    const { w, u, advance, count } = world();
    w.server.available = true;
    await u.check('start');
    u.accept();
    assert.equal(u.state.phase, 'switching');
    assert.equal(u.state.prompt, null);
    assert.equal(count('reload'), 0, 'not yet: the screen is shown first');
    u.accept();
    u.accept();
    await advance(SWITCH_DELAY_MS - 1);
    assert.equal(count('reload'), 0);
    await advance(2);
    assert.equal(count('reload'), 1);
    assert.deepEqual(w.attempts, ['u1']);
    await advance(5000);
    assert.equal(count('reload'), 1, 'never twice for the same version');
  });
  it('a long job is running: it waits, then asks when the job is over', async () => {
    const { w, u, advance } = world();
    w.server.available = true;
    w.sit.working = true;
    await u.check('start');
    assert.equal(u.state.prompt, null);
    await advance(WAIT_POLL_MS * 3);
    assert.equal(u.state.prompt, null);
    w.sit.working = false;
    await advance(WAIT_POLL_MS + 10);
    assert.equal(u.state.prompt?.id, 'u1');
  });
});

describe('auto', () => {
  it('nothing playing: switches by itself', async () => {
    const { w, u, advance, count } = world({ mode: 'auto' });
    w.server.available = true;
    await u.check('start');
    assert.equal(u.state.phase, 'switching');
    assert.equal(u.state.prompt, null, 'no question');
    await advance(SWITCH_DELAY_MS + 5);
    assert.equal(count('reload'), 1);
  });
  it('music playing: waits – and switches once it has stopped', async () => {
    const { w, u, advance, count } = world({ mode: 'auto' });
    w.server.available = true;
    w.sit.playing = true;
    await u.check('start');
    assert.equal(u.state.phase, 'idle');
    await advance(WAIT_POLL_MS * 5);
    assert.equal(count('reload'), 0, 'not while music plays');
    w.sit.playing = false;
    await advance(WAIT_POLL_MS + SWITCH_DELAY_MS + 50);
    assert.equal(count('reload'), 1);
  });
  it('a job running (saving songs, writing a file): waits for it too', async () => {
    const { w, u, advance, count } = world({ mode: 'auto' });
    w.server.available = true;
    w.sit.working = true;
    await u.check('start');
    await advance(WAIT_POLL_MS * 4);
    assert.equal(count('reload'), 0);
    w.sit.working = false;
    u.reevaluate();
    await advance(SWITCH_DELAY_MS + 50);
    assert.equal(count('reload'), 1);
  });
});

describe('manual', () => {
  it('nothing happens by itself, but the button (accept) still works', async () => {
    const { w, u, advance, count } = world({ mode: 'manual' });
    w.server.available = true;
    await u.check('start');
    await advance(60_000);
    assert.equal(u.state.prompt, null);
    assert.equal(u.state.phase, 'idle');
    assert.equal(count('reload'), 0);
    assert.equal(u.state.pending?.id, 'u1');
    u.accept();
    await advance(SWITCH_DELAY_MS + 5);
    assert.equal(count('reload'), 1);
  });
});

describe('when the system found the update by itself (at start-up)', () => {
  it('it is handled just the same: asked about once; a repeat of the same news changes nothing', () => {
    const { u } = world();
    u.observePending({ id: 'native1', note: '起動時に取得' });
    assert.deepEqual(u.state.prompt, { id: 'native1', note: '起動時に取得', playing: false });
    const before = u.state;
    u.observePending({ id: 'native1', note: '起動時に取得' });
    assert.equal(u.state, before);
  });
  it('"there is none" clears the waiting version – except while switching', async () => {
    const { u } = world({ mode: 'manual' });
    u.observePending({ id: 'a', note: null });
    u.observePending(null);
    assert.equal(u.state.pending, null);
    u.observePending({ id: 'b', note: null });
    u.accept();
    u.observePending(null);
    assert.equal(u.state.pending?.id, 'b', 'the reload is on its way');
  });
});

describe('the system announcing a download while the look is still running', () => {
  /** like the phone: the system tells us about the new version DURING the download, before our own look is finished */
  const announceDuringFetch = (w: ReturnType<typeof world>['w'], u: Updater) => {
    w.fetchImpl = async () => {
      u.observePending({ id: 'u1', note: '新機能' });
      return { isNew: true, manifest: { id: 'u1', extra: { releaseNote: '新機能' } } } as never;
    };
  };
  it('auto: one switch, one reload (not two)', async () => {
    const { w, u, advance, count } = world({ mode: 'auto' });
    w.server.available = true;
    announceDuringFetch(w, u);
    await u.check('start');
    assert.equal(u.state.phase, 'switching', 'the switch that the announcement started is not undone by the look finishing');
    await advance(SWITCH_DELAY_MS * 4);
    assert.equal(count('reload'), 1);
    assert.deepEqual(w.attempts, ['u1']);
  });
  it('ask: one question (not two)', async () => {
    const { w, u } = world();
    w.server.available = true;
    announceDuringFetch(w, u);
    await u.check('start');
    assert.equal(w.states.filter((s) => s.prompt !== null && w.states[w.states.indexOf(s) - 1]?.prompt === null).length, 1);
    assert.equal(u.state.prompt?.id, 'u1');
  });
  it('a failing look that ends while a switch is on its way does not cancel the switch', async () => {
    const { w, u, advance, count } = world({ mode: 'auto' });
    w.server.available = true;
    w.fetchImpl = async () => {
      u.observePending({ id: 'u1', note: null });
      throw new Error('late failure');
    };
    assert.equal(await u.check('start'), 'error');
    assert.equal(u.state.phase, 'switching');
    await advance(SWITCH_DELAY_MS + 10);
    assert.equal(count('reload'), 1);
  });
  it('asking to switch again while the first switch waits for its moment changes nothing', async () => {
    const { w, u, advance, count } = world({ mode: 'manual' });
    w.server.available = true;
    await u.check('start');
    for (let i = 0; i < 5; i++) u.accept();
    await advance(SWITCH_DELAY_MS * 3);
    assert.equal(count('reload'), 1);
  });
});

describe('things that go wrong', () => {
  it('a version that did not start last time is never forced again (no loop of crash → reload → crash)', async () => {
    for (const mode of ['ask', 'auto'] as const) {
      const { w, u, advance, count } = world({ mode });
      w.bad.add('u1');
      w.server.available = true;
      await u.check('start');
      await advance(60_000);
      assert.equal(u.state.prompt, null, mode);
      assert.equal(count('reload'), 0, mode);
      assert.equal(u.state.pending?.id, 'u1');
    }
  });
  it('a reload that fails: the switching screen goes, the reason is kept, and it can be tried again', async () => {
    const { w, u, advance, count } = world();
    w.server.available = true;
    w.reloadImpl = async () => { throw new Error('reload not possible'); };
    await u.check('start');
    u.accept();
    await advance(SWITCH_DELAY_MS + 5);
    assert.equal(u.state.phase, 'idle');
    assert.equal(u.state.lastError, 'reload not possible');
    w.reloadImpl = async () => {};
    u.accept();
    await advance(SWITCH_DELAY_MS + 5);
    assert.equal(count('reload'), 2);
  });
  it('a reload that quietly does not happen: after a while the switching screen goes away', async () => {
    const { w, u, advance } = world();
    w.server.available = true;
    await u.check('start');
    u.accept();
    await advance(SWITCH_DELAY_MS + 5);
    assert.equal(u.state.phase, 'switching');
    await advance(RELOAD_TIMEOUT_MS + 10);
    assert.equal(u.state.phase, 'idle');
    assert.equal(u.state.lastError, '切り替えられませんでした');
  });
  it('after dispose nothing more happens (no reload from a timer that was still waiting)', async () => {
    const { w, u, advance, count } = world({ mode: 'auto' });
    w.server.available = true;
    await u.check('start');
    u.dispose();
    await advance(SWITCH_DELAY_MS * 3);
    assert.equal(count('reload'), 0);
    assert.equal(await u.check('manual'), 'skipped');
  });
  it('every change is reported to the screen, in order, and the last one is the state', async () => {
    const { w, u } = world();
    w.server.available = true;
    await u.check('start');
    assert.equal(w.states.at(-1), u.state);
    assert.ok(w.states.length >= 4);
  });
});
