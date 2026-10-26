import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appleNewReleasesUrl, parseAppleFeed, sameTitle } from '../src/core/appleNew';

test('the feed address is for the country and the number asked for', () => {
  assert.equal(appleNewReleasesUrl('jp', 30), 'https://rss.marketingtools.apple.com/api/v2/jp/music/most-played/30/albums.json');
});

test('the releases are read from the feed, with a 300 pixel picture', () => {
  const json = {
    feed: {
      results: [
        { id: '1', name: 'アルバム', artistName: '歌手', artworkUrl100: 'https://x/a/100x100bb.jpg', url: 'https://x/1' },
        { id: 2, name: '壊れた', artistName: '歌手' },
        { id: '3', name: 'シングル', artistName: '別の人', artworkUrl100: 'https://x/b/100x100bb.jpg' },
      ],
    },
  };
  const got = parseAppleFeed(json);
  assert.equal(got.length, 2);
  assert.equal(got[0].artwork, 'https://x/a/300x300bb.jpg');
  assert.equal(got[1].artist, '別の人');
  assert.equal(got[1].url, '');
});

test('a feed that is not in that shape gives nothing', () => {
  assert.deepEqual(parseAppleFeed(null), []);
  assert.deepEqual(parseAppleFeed({ feed: {} }), []);
});

test('titles match ignoring case and spaces', () => {
  assert.equal(sameTitle('Night  Rain', 'nightrain'), true);
  assert.equal(sameTitle('A', 'B'), false);
});
