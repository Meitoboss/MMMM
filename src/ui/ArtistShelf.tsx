import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { TASTE_ARTISTS_SHOWN } from '../core/taste';
import type { ArtistItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { getTaste } from '../state/taste';
import { SectionCarousel } from './components';
import { useScheme } from './theme';

/**
 * Home: artists you may like, from the artists that come up most in your taste mix. Artists you bookmarked are left out
 * (the bookmarks themselves are unchanged). Nothing is shown when there are none.
 */
export function ArtistShelf() {
  useScheme();
  const [artists, setArtists] = useState<ArtistItem[]>([]);
  // read again every time the home tab comes back into view, so a new bookmark is left out at once
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([getTaste(), openDb().then((db) => repo.bookmarkedArtists(db))])
        .then(([mix, bookmarked]) => {
          if (!alive) return;
          const skip = new Set(bookmarked.map((a) => a.id));
          setArtists(mix.artists.filter((a) => !skip.has(a.id)).slice(0, TASTE_ARTISTS_SHOWN));
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );
  if (!artists.length) return null;
  return <SectionCarousel section={{ title: 'おすすめのアーティスト', items: artists }} />;
}
