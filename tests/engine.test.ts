import assert from 'node:assert/strict';
import vm from 'node:vm';
import { describe, it } from 'node:test';

import { BRIDGE, PO_TOKEN_SCRIPT, buildEngineHtml } from '../src/ui/engineHtml';

/** Runs the page scripts in a browser-like global and lets us call __rpc like EngineHost does. */
function makePage() {
  const messages: any[] = [];
  const ctx: any = {
    TextEncoder,
    Uint8Array,
    setInterval,
    clearInterval,
    console,
    addEventListener: () => undefined,
    ReactNativeWebView: { postMessage: (s: string) => messages.push(JSON.parse(s)) },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(PO_TOKEN_SCRIPT, ctx);
  vm.runInContext(BRIDGE, ctx);
  const call = (m: Record<string, unknown>) =>
    new Promise<any>((resolve) => {
      const id = Math.random();
      const iv = setInterval(() => {
        const r = messages.find((x) => x.id === id);
        if (r) {
          clearInterval(iv);
          resolve(r);
        }
      }, 1);
      ctx.__rpc({ id, ...m });
    });
  return { ctx, messages, call };
}

describe('engine page scripts', () => {
  it('both scripts parse and the bridge announces readiness', () => {
    const { messages } = makePage();
    assert.deepEqual(messages[0], { type: 'ready' });
  });

  it('exposes the BotGuard helpers from po_token.html', () => {
    const { ctx } = makePage();
    assert.equal(typeof ctx.runBotGuard, 'function');
    assert.equal(typeof ctx.obtainPoToken, 'function');
  });

  it('html wrapper contains both scripts', () => {
    const html = buildEngineHtml();
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('function runBotGuard') && html.includes('window.__rpc'));
  });

  it('answers ping and reports unknown commands as errors', async () => {
    const { call } = makePage();
    const pong = await call({ cmd: 'ping' });
    assert.equal(pong.ok, true);
    assert.equal(pong.result, 'pong');
    const bad = await call({ cmd: 'nope' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /unknown command/);
  });

  it('mints with the webPoSignalOutput / integrityToken it was given', async () => {
    const { ctx, call } = makePage();
    // fake BotGuard result, created inside the page realm so `instanceof Function` behaves like in a browser
    vm.runInContext(
      'window.webPoSignalOutput = [function (token) { return function (id) { return Uint8Array.from(Array.from(token).concat(Array.from(id))); }; }];',
      ctx,
    );
    assert.equal((await call({ cmd: 'integrity', bytes: [9, 8] })).ok, true);
    const r = await call({ cmd: 'mint', identifier: 'ab' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result, '9,8,97,98');
  });

  it('loads the solver without letting it navigate the page, then solves', async () => {
    const { ctx, call } = makePage();
    const lib = 'var lib = { meriyah: {}, astring: {} };';
    // minimal stand-in for yt.solver.core.min.js: assigns globalThis.location like the real one, defines jsc()
    const core = `
      globalThis.location = "https://www.youtube.com/watch?v=yt-dlp-wins";
      var jsc = function (input) {
        var player = input.type === 'player' ? input.player : input.preprocessed_player;
        return {
          type: 'result',
          preprocessed_player: input.type === 'player' ? 'PRE:' + player : undefined,
          responses: input.requests.map(function (r) {
            var data = {};
            r.challenges.forEach(function (c) { data[c] = c.split('').reverse().join(''); });
            return { type: 'result', data: data };
          }),
        };
      };`;
    const loaded = await call({ cmd: 'loadSolver', lib, core });
    assert.equal(loaded.ok, true, loaded.error);
    assert.equal(loaded.result, 'function');
    assert.equal(ctx.location, undefined, 'location must not be assigned (that would navigate the WebView)');
    assert.equal(ctx.__ejsLocation, 'https://www.youtube.com/watch?v=yt-dlp-wins');

    const reqs = [{ type: 'n', challenges: ['abc'] }];
    // without a cached player -> NEED_PLAYER
    const need = await call({ cmd: 'solve', playerId: 'p1', requests: reqs });
    assert.equal(need.ok, false);
    assert.match(need.error, /NEED_PLAYER/);
    // first call with the text caches the preprocessed player
    const first = await call({ cmd: 'solve', playerId: 'p1', player: 'BASEJS', requests: reqs });
    assert.equal(first.ok, true, first.error);
    assert.equal(first.result.responses[0].data.abc, 'cba');
    // later calls need no player text
    const again = await call({ cmd: 'solve', playerId: 'p1', requests: [{ type: 'sig', challenges: ['xyz'] }] });
    assert.equal(again.result.responses[0].data.xyz, 'zyx');
    // a different player id needs the text again
    assert.match((await call({ cmd: 'solve', playerId: 'p2', requests: reqs })).error, /NEED_PLAYER/);
  });
});
