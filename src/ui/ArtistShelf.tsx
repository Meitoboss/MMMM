import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { ArtistItem } from '../core/types';
import { openDb } from '../db/expo';
import * as repo from '../db/repo';
import { SectionCarousel } from './components';
import { useScheme } from './theme';

/** Home: the artists you bookmarked, as round pictures (the same as on an artist's page). Nothing is shown without bookmarks. */
export function ArtistShelf() {
  useScheme();
  const [artists, setArtists] = useState<ArtistItem[]>([]);
  // read again every time the home tab comes back into view, so a new bookmark shows up
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      openDb()
        .then((db) => repo.bookmarkedArtists(db))
        .then((list) => alive && setArtists(list))
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );
  if (!artists.length) return null;
  return <SectionCarousel section={{ title: 'ブックマークしたアーティスト', items: artists }} />;
}
