/**
 * Home screen shelves built from what was played and liked on this phone. Pure logic.
 */
export interface DayRange {
  /** [start, end) in ms, local time */
  start: number;
  end: number;
  /** how many years back this day is */
  years: number;
}

/** the same calendar day, `years` back: "この日に聴いた曲" */
export function sameDayBefore(now: Date, years: number[]): DayRange[] {
  return years.map((y) => {
    const start = new Date(now.getFullYear() - y, now.getMonth(), now.getDate()).getTime();
    const end = new Date(now.getFullYear() - y, now.getMonth(), now.getDate() + 1).getTime();
    return { start, end, years: y };
  });
}

export type PartOfDay = 'morning' | 'day' | 'evening' | 'night';
export const PART_OF_DAY_LABEL: Record<PartOfDay, string> = { morning: '朝', day: '昼', evening: '夕方', night: '夜' };
/** the hours (0–23) of each part of the day */
export const PART_OF_DAY_HOURS: Record<PartOfDay, number[]> = {
  morning: [5, 6, 7, 8, 9, 10],
  day: [11, 12, 13, 14, 15, 16],
  evening: [17, 18, 19, 20, 21],
  night: [22, 23, 0, 1, 2, 3, 4],
};

export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** how long a liked song must be unplayed to count as "久しぶり" */
export const FORGOTTEN_AFTER_MS = 30 * 86_400_000;
/** how many artists' albums are looked at for "新しいアルバム・シングル" */
export const RELEASE_ARTISTS = 6;
/** albums (or singles) taken from each of those artists */
export const RELEASES_PER_ARTIST = 2;
