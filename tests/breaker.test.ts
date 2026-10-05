import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  BREAKER_FAILURES,
  BREAKER_PAUSE_MS,
  configureRemotePot,
  mintRemote,
  remotePauseSecondsLeft,
  resetRemoteBreaker,
} from '../src/core/pot/remote';

const realFetch = globalThis.fetch;
const realNow = Date.now;
let clock = 1_000_000;
let calls = 0;
let behaviour: (n: number) => Response | Promise<Response>;

const ok = (token = 't') => new Response(JSON.stringify({ poToken: token, expiresAt: new Date(clock + 3_600_000).toISOString() }), { status: 200 });
const status = (code: number) => new Response('x', { status: code });

beforeEach(() => {
  clock = 1_000_000;
  Date.now = () => clock;
  calls = 0;
  behaviour = () => ok();
  globalThis.fetch = (async () => {
    calls += 1;
    return behaviour(calls);
  }) as typeof fetch;
  configureRemotePot({ url: 'https://pot.example', key: 'k' });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  configureRemotePot(null);
});

const fail = async (binding: string) => {
  try {
    await mintRemote(binding, 50);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe('token server circuit breaker', () => {
  it('after repeated failures the server is left alone: no request, instant answer', async () => {
    behaviour = () => Promise.reject(new Error('Network request failed'));
    for (let i = 0; i < BREAKER_FAILURES; i++) await fail(`a${i}`);
    assert.ok(remotePauseSecondsLeft() > 0);
    const before = calls;
    const t0 = Date.now();
    assert.match((await fail('next')) ?? '', /paused after repeated failures/);
    assert.equal(calls, before, 'no request while paused');
    assert.equal(Date.now(), t0);
  });

  it('tries again after the pause, and one success ends it completely', async () => {
    behaviour = () => Promise.reject(new Error('down'));
    for (let i = 0; i < BREAKER_FAILURES; i++) await fail(`a${i}`);
    clock += BREAKER_PAUSE_MS + 1;
    assert.equal(remotePauseSecondsLeft(), 0);
    behaviour = () => ok('back');
    assert.equal(await mintRemote('b1'), 'back');
    // the counter was reset: a single new failure does not pause again
    behaviour = () => Promise.reject(new Error('blip'));
    await fail('b2');
    assert.equal(remotePauseSecondsLeft(), 0);
  });

  it('a success in between resets the count', async () => {
    behaviour = (n) => (n === 2 ? ok() : Promise.reject(new Error('blip')));
    await fail('x1'); // failure 1
    assert.ok(await mintRemote('x2')); // success → reset
    await fail('x3'); // failure 1 again
    assert.equal(remotePauseSecondsLeft(), 0);
  });

  it('server errors (5xx) count, client errors do not', async () => {
    behaviour = () => status(400);
    for (let i = 0; i < 5; i++) await fail(`c${i}`);
    assert.equal(remotePauseSecondsLeft(), 0, '4xx never pauses');
    behaviour = () => status(502);
    for (let i = 0; i < BREAKER_FAILURES; i++) await fail(`d${i}`);
    assert.ok(remotePauseSecondsLeft() > 0, '5xx does');
  });

  it('a wrong key (401) is reported at once and never pauses the server', async () => {
    behaviour = () => status(401);
    for (let i = 0; i < 6; i++) assert.match((await fail(`k${i}`)) ?? '', /refused the key/);
    assert.equal(remotePauseSecondsLeft(), 0);
  });

  it('a hung server is given up on after the timeout (not left waiting for ever)', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as unknown as typeof fetch;
    const started = realNow();
    const msg = await fail('slow');
    assert.match(msg ?? '', /did not answer within/);
    assert.ok(realNow() - started < 2000);
    await fail('slow2');
    assert.ok(remotePauseSecondsLeft() > 0, 'two hangs pause it');
  });

  it('cached tokens still work while paused (songs already prepared are not affected)', async () => {
    assert.equal(await mintRemote('warm'), 't');
    behaviour = () => Promise.reject(new Error('down'));
    for (let i = 0; i < BREAKER_FAILURES; i++) await fail(`e${i}`);
    assert.equal(await mintRemote('warm'), 't');
  });

  it('new settings, or the connection test, lift the pause', async () => {
    behaviour = () => Promise.reject(new Error('down'));
    for (let i = 0; i < BREAKER_FAILURES; i++) await fail(`f${i}`);
    assert.ok(remotePauseSecondsLeft() > 0);
    resetRemoteBreaker();
    assert.equal(remotePauseSecondsLeft(), 0);
    for (let i = 0; i < BREAKER_FAILURES; i++) await fail(`g${i}`);
    configureRemotePot({ url: 'https://pot.example', key: 'new' });
    assert.equal(remotePauseSecondsLeft(), 0);
  });
});
