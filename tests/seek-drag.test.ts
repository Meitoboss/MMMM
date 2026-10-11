import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HOLD_CLOSE, dragMoved, holdReached, shownPosition, sliderValue } from '../src/core/seekDrag';

describe('the seek bar while dragging', () => {
  it('the first report begins the drag at that value; later reports move only the finger, not the start', () => {
    const a = dragMoved(null, 30);
    assert.deepEqual(a, { start: 30, now: 30 });
    const b = dragMoved(a, 55);
    assert.deepEqual(b, { start: 30, now: 55 });
    assert.deepEqual(dragMoved(b, 80), { start: 30, now: 80 });
  });

  it('the slider is given the SAME value all through a drag (so that it is not fought with), the label follows the finger', () => {
    let d = null as ReturnType<typeof dragMoved> | null;
    const given: number[] = [];
    const labels: number[] = [];
    for (const v of [30, 31, 44, 60, 12]) {
      d = dragMoved(d, v);
      given.push(sliderValue(d, null, 99));
      labels.push(shownPosition(d, null, 99));
    }
    assert.deepEqual(given, [30, 30, 30, 30, 30]);
    assert.deepEqual(labels, [30, 31, 44, 60, 12]);
  });

  it('with no finger and no hold, both follow the player', () => {
    assert.equal(sliderValue(null, null, 42), 42);
    assert.equal(shownPosition(null, null, 42), 42);
  });

  it('after the finger is lifted the chosen position is held (slider and label) until the player is close to it', () => {
    assert.equal(sliderValue(null, 120, 40), 120);
    assert.equal(shownPosition(null, 120, 40), 120);
    assert.equal(holdReached(120, 40), false);
    assert.equal(holdReached(120, 119), true);
    assert.equal(holdReached(120, 120 + HOLD_CLOSE - 0.01), true);
    assert.equal(holdReached(120, 120 + HOLD_CLOSE), false);
    assert.equal(holdReached(null, 5), false);
  });

  it('a new drag during a hold wins over the hold', () => {
    const d = dragMoved(null, 10);
    assert.equal(sliderValue(d, 120, 40), 10);
    assert.equal(shownPosition(dragMoved(d, 20), 120, 40), 20);
  });
});
