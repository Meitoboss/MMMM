/** Where to put the "recently played" shelf on the home screen. */

// YouTube Music's own shelf titles ("Today's hits", "Trending", …) in English and Japanese.
// Plain substring checks on purpose – no regular expression is created while the app starts.
const KEYWORDS = ['todayshits', 'trending', '急上昇', 'トレンド', 'ヒット', '話題', '人気'];

/** lower-case, without spaces and apostrophes ("Today’s Hits" → "todayshits") */
function normalize(title: string): string {
  let out = '';
  for (const ch of title.toLowerCase()) {
    if (ch === ' ' || ch === "'" || ch === '\u2019' || ch === '\u2018' || ch === '`' || ch === '\u00a0') continue;
    out += ch;
  }
  return out;
}

function isHitsOrTrending(title: string): boolean {
  const t = normalize(title);
  return KEYWORDS.some((k) => t.includes(k));
}

/**
 * Index at which to insert the recent shelf: right after the last "hits / trending" shelf.
 * When none of the titles match (other region / language) it goes after the first two shelves.
 */
export function recentInsertIndex(titles: readonly string[]): number {
  let last = -1;
  titles.forEach((t, i) => {
    if (isHitsOrTrending(t)) last = i;
  });
  return last >= 0 ? last + 1 : Math.min(2, titles.length);
}
