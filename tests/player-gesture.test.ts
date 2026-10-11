import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * How the player screen is closed by a swipe. On iPhone it is a sheet and the SHEET's own swipe closes it: the app's own swipe was
 * taken away from it after a few points (the screen moved a little and sprang back). On Android the app's swipe does it.
 * These are settings in two files that a careless edit could undo, so they are checked here.
 */
describe('how the player is closed by a swipe', () => {
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  const player = readFileSync('app/player.tsx', 'utf8');

  it('the sheet\'s own gesture is on for iPhone (and only there)', () => {
    const line = layout.split('\n').find((l) => l.includes('name="player"')) ?? '';
    assert.match(line, /presentation: 'modal'/);
    assert.match(line, /gestureEnabled: Platform\.OS === 'ios'/);
  });

  it('the screen\'s own swipe handlers are attached on Android only', () => {
    assert.match(player, /const closesBySwipe = Platform\.OS !== 'ios';/);
    assert.match(player, /\{\.\.\.\(closesBySwipe \? swipe\.panHandlers : \{\}\)\}/);
    assert.ok(!/\{\.\.\.swipe\.panHandlers\}/.test(player), 'the handlers are never attached unconditionally');
  });

  it('the seek bar is left out of the swipe by its position and only on Android', () => {
    assert.match(player, /seekBand: Platform\.OS === 'android' \? seekBand\.current : null/);
  });
});
