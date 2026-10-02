/** Where to put the "recently played" shelf on the home screen. */

// YouTube Music's own shelf titles ("Today's hits", "Trending", …) in English and Japanese
const HITS_OR_TRENDING = /today.?s\s*hits|trending|急上昇|トレンド|ヒット|話題|人気/i;

/**
 * Index at which to insert the recent shelf: right after the last "hits / trending" shelf.
 * When none of the titles match (other region / language) it goes after the first two shelves.
 */
export function recentInsertIndex(titles: readonly string[]): number {
  let last = -1;
  titles.forEach((t, i) => {
    if (HITS_OR_TRENDING.test(t)) last = i;
  });
  return last >= 0 ? last + 1 : Math.min(2, titles.length);
}
