import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { START_DISTANCE, startsSwipeDown, swipeGate, swipeLine, swipeOutcome } from '../src/core/swipe';

const band = { top: 600, bottom: 640 };
const base = { seekBand: null, listTop: 0, topLimit: 111 };

describe('may a touch start a swipe that closes the screen?', () => {
  it('yes, from anywhere, when no list is scrolled down', () => {
    for (const touchY of [0, 50, 300, 700, 800]) assert.deepEqual(swipeGate({ ...base, touchY }), { ok: true, why: 'ok' }, String(touchY));
  });

  it('not from the seek bar (when it is given – Android); everywhere else it is fine', () => {
    assert.deepEqual(swipeGate({ ...base, touchY: 620, seekBand: band }), { ok: false, why: 'seek-bar' });
    assert.deepEqual(swipeGate({ ...base, touchY: 300, seekBand: band }), { ok: true, why: 'ok' });
  });

  it('on iPhone no band is given: the seek bar never refuses a swipe', () => {
    assert.deepEqual(swipeGate({ ...base, touchY: 620, seekBand: null }), { ok: true, why: 'ok' });
  });

  it('a list that is scrolled down must scroll back first – except for a touch in the top bar', () => {
    assert.deepEqual(swipeGate({ ...base, touchY: 400, listTop: 300 }), { ok: false, why: 'list-scrolled' });
    assert.deepEqual(swipeGate({ ...base, touchY: 80, listTop: 300 }), { ok: true, why: 'ok' });
    assert.deepEqual(swipeGate({ ...base, touchY: 400, listTop: 2 }), { ok: true, why: 'ok' });
    assert.deepEqual(swipeGate({ ...base, touchY: 400, listTop: -30 }), { ok: true, why: 'ok' }, 'a list pulled past its top');
  });

  it('the seek bar is named first when both apply', () => {
    assert.equal(swipeGate({ touchY: 620, seekBand: band, listTop: 500, topLimit: 111 }).why, 'seek-bar');
  });
});

describe('the lines for the on-screen log', () => {
  it('say what happened to the touch in a few words, with the reason when a swipe is refused', () => {
    assert.equal(swipeLine.touch(612.4), 'swipe: touch y=612');
    assert.equal(swipeLine.move(3.2, 41.6, true, { ok: true, why: 'ok' }), 'swipe: move dx=3 dy=42 down=yes gate=ok');
    assert.equal(swipeLine.move(60, 20, false, { ok: false, why: 'seek-bar' }), 'swipe: move dx=60 dy=20 down=no gate=seek-bar');
    assert.equal(swipeLine.grabbed(), 'swipe: taken (the screen follows the finger)');
    assert.equal(swipeLine.release(233.2, 1.234, 'close'), 'swipe: release dy=233 vy=1.23 -> close');
    assert.equal(swipeLine.release(30, 0.1, 'back'), 'swipe: release dy=30 vy=0.10 -> back');
    assert.equal(swipeLine.terminated(), 'swipe: taken away by the system');
  });

  it('a short drag is judged by the same rules as before (nothing about the swipe itself changed)', () => {
    assert.equal(startsSwipeDown(0, START_DISTANCE), false);
    assert.equal(startsSwipeDown(0, START_DISTANCE + 1), true);
    assert.equal(startsSwipeDown(40, 50), false, 'mostly sideways');
    assert.equal(swipeOutcome(150, 0.1, 800), 'close');
    assert.equal(swipeOutcome(50, 1, 800), 'close');
    assert.equal(swipeOutcome(50, 0.1, 800), 'back');
  });
});
