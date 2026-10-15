import { PART_OF_DAY_HOURS, PART_OF_DAY_LABEL, partOfDay } from './homeMemory';

/**
 * The mood dial: the first position follows the time of day, the others are feelings.
 * A feeling picks the songs that have a tag whose name contains one of its words (tags are set on the song's "…" menu).
 */
export interface MoodOption {
  key: string;
  label: string;
  /** words that a tag name must contain (case-insensitive) */
  words: string[];
}

export const TIME_OPTION: MoodOption = { key: 'time', label: '今の時間帯', words: [] };

export const MOODS: MoodOption[] = [
  { key: 'happy', label: '元気', words: ['元気', 'ハッピー', '明るい', 'アップ'] },
  { key: 'calm', label: '落ち着く', words: ['落ち着', 'リラックス', '穏やか', 'ゆったり'] },
  { key: 'bittersweet', label: 'せつない', words: ['せつない', '切ない', 'しっとり', 'エモ'] },
  { key: 'hype', label: '盛り上がる', words: ['盛り上', 'ノリノリ', 'アゲ', 'テンション'] },
  { key: 'sleepy', label: 'ねむい', words: ['ねむい', '眠い', 'おやすみ', '夜'] },
];

/** the dial's positions in order: the time of day first, then the feelings */
export const DIAL_OPTIONS: MoodOption[] = [TIME_OPTION, ...MOODS];

/** the label on the dial's center while the time of day is chosen, e.g. "今（夜）" */
export function timeLabel(now: Date): string {
  return `今（${PART_OF_DAY_LABEL[partOfDay(now.getHours())]}）`;
}

/** the hours that belong to the time of day now */
export function nowHours(now: Date): number[] {
  return PART_OF_DAY_HOURS[partOfDay(now.getHours())];
}

/** the ids of the tags whose name contains one of the option's words */
export function matchTagIds(tags: { id: number; name: string }[], option: MoodOption): number[] {
  const words = option.words.map((w) => w.toLowerCase());
  return tags.filter((t) => words.some((w) => t.name.toLowerCase().includes(w))).map((t) => t.id);
}

/** degrees between two dial positions */
export const DIAL_STEP = 360 / DIAL_OPTIONS.length;

/** which option sits at the top for a dial turned by `angle` degrees */
export function selectedIndex(angle: number): number {
  const n = DIAL_OPTIONS.length;
  return ((Math.round(-angle / DIAL_STEP) % n) + n) % n;
}

/** the angle at which option `index` sits at the top */
export function angleFor(index: number): number {
  return -index * DIAL_STEP;
}
