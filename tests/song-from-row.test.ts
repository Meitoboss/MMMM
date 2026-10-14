import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { songFromRow } from '../src/db/repo';

const row = (durationText: string | null) =>
  ({ id: 'abc', title: 'e:Song', artistsText: 'A, B', durationText, thumbnailUrl: null }) as Parameters<typeof songFromRow>[0];

describe('a song read back from the database', () => {
  it('keeps its length in seconds, so the player can tell a file that claims double its length', () => {
    const s = songFromRow(row('3:00'));
    assert.equal(s.durationText, '3:00');
    assert.equal(s.durationSec, 180);
    assert.equal(s.explicit, true);
    assert.deepEqual(s.artists, [{ name: 'A' }, { name: 'B' }]);
  });

  it('handles hours and a missing length', () => {
    assert.equal(songFromRow(row('1:02:03')).durationSec, 3723);
    assert.equal(songFromRow(row(null)).durationSec, undefined);
  });
});
