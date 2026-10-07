import type { SqlValue } from '../db/driver';

/**
 * Smart playlists: a list of rules that is turned into one SQL query each time the playlist is opened,
 * so it is always up to date. Everything the user typed goes in as a parameter, never into the SQL text.
 */
export type Rule =
  | { field: 'liked'; value: boolean }
  | { field: 'tag'; op: 'has' | 'hasNot'; tagId: number }
  | { field: 'plays'; op: 'gte' | 'lte'; value: number }
  | { field: 'lastPlayed'; op: 'within' | 'notWithin'; days: number }
  | { field: 'artist'; value: string }
  | { field: 'title'; value: string }
  | { field: 'source'; value: 'youtube' | 'local' | 'offline' }
  /** songs whose tempo has been set and lies in this range */
  | { field: 'bpm'; min: number; max: number };

export type SmartSort = 'recent' | 'oldestPlayed' | 'mostPlayed' | 'leastPlayed' | 'title' | 'added' | 'random' | 'bpm';

export interface SmartRules {
  match: 'all' | 'any';
  rules: Rule[];
  sort: SmartSort;
  limit: number;
}

export const SMART_SORTS: { value: SmartSort; label: string }[] = [
  { value: 'recent', label: '最近聞いた順' },
  { value: 'oldestPlayed', label: '長く聞いていない順' },
  { value: 'mostPlayed', label: '再生回数が多い順' },
  { value: 'leastPlayed', label: '再生回数が少ない順' },
  { value: 'title', label: '曲名順' },
  { value: 'added', label: '追加が新しい順' },
  { value: 'bpm', label: 'BPM が小さい順' },
  { value: 'random', label: 'ランダム' },
];

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
const DAY_MS = 86_400_000;

export const emptyRules = (): SmartRules => ({ match: 'all', rules: [], sort: 'recent', limit: DEFAULT_LIMIT });

const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : null;
};

/** keeps only valid rules – what is stored (or hand-edited) can never break a query */
export function sanitizeRules(raw: unknown): SmartRules {
  const out = emptyRules();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.match === 'any') out.match = 'any';
  if (SMART_SORTS.some((s) => s.value === r.sort)) out.sort = r.sort as SmartSort;
  out.limit = int(r.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  if (!Array.isArray(r.rules)) return out;
  for (const x of r.rules.slice(0, 20)) {
    const q = x as Record<string, unknown> | null;
    if (!q || typeof q !== 'object') continue;
    switch (q.field) {
      case 'liked':
        if (typeof q.value === 'boolean') out.rules.push({ field: 'liked', value: q.value });
        break;
      case 'tag': {
        const id = int(q.tagId, 1, Number.MAX_SAFE_INTEGER);
        if (id !== null && (q.op === 'has' || q.op === 'hasNot')) out.rules.push({ field: 'tag', op: q.op, tagId: id });
        break;
      }
      case 'plays': {
        const v = int(q.value, 0, 1_000_000);
        if (v !== null && (q.op === 'gte' || q.op === 'lte')) out.rules.push({ field: 'plays', op: q.op, value: v });
        break;
      }
      case 'lastPlayed': {
        const d = int(q.days, 0, 36500);
        if (d !== null && (q.op === 'within' || q.op === 'notWithin')) out.rules.push({ field: 'lastPlayed', op: q.op, days: d });
        break;
      }
      case 'artist':
      case 'title':
        if (typeof q.value === 'string' && q.value.trim()) out.rules.push({ field: q.field, value: q.value.trim().slice(0, 100) });
        break;
      case 'source':
        if (q.value === 'youtube' || q.value === 'local' || q.value === 'offline') out.rules.push({ field: 'source', value: q.value });
        break;
      case 'bpm': {
        const a = int(q.min, 30, 300);
        const b = int(q.max, 30, 300);
        if (a !== null && b !== null) out.rules.push({ field: 'bpm', min: Math.min(a, b), max: Math.max(a, b) });
        break;
      }
    }
  }
  return out;
}

function escapeLike(text: string): string {
  return text.split('\\').join('\\\\').split('%').join('\\%').split('_').join('\\_');
}

/** "contains this text" as a LIKE pattern: % _ and \ in the text are taken literally (use with ESCAPE '\') */
export function likeContains(text: string): string {
  return `%${escapeLike(text)}%`;
}

/** "starts with this text", same rules */
export function likePrefix(text: string): string {
  return `${escapeLike(text)}%`;
}

function condition(rule: Rule, now: number, params: SqlValue[]): string {
  switch (rule.field) {
    case 'liked':
      return rule.value ? 'Song.likedAt IS NOT NULL' : 'Song.likedAt IS NULL';
    case 'tag':
      params.push(rule.tagId);
      return `${rule.op === 'hasNot' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM SongTag WHERE SongTag.songId = Song.id AND SongTag.tagId = ?)`;
    case 'plays':
      params.push(rule.value);
      return `COALESCE(ev.plays, 0) ${rule.op === 'gte' ? '>=' : '<='} ?`;
    case 'lastPlayed':
      params.push(now - rule.days * DAY_MS);
      // "within N days" = played at least once since then; "not within" also holds for songs never played
      return rule.op === 'within' ? '(ev.lastAt IS NOT NULL AND ev.lastAt >= ?)' : '(ev.lastAt IS NULL OR ev.lastAt < ?)';
    case 'artist':
      params.push(likeContains(rule.value));
      return "Song.artistsText LIKE ? ESCAPE '\\'";
    case 'title':
      params.push(likeContains(rule.value));
      return "Song.title LIKE ? ESCAPE '\\'";
    case 'bpm':
      params.push(rule.min, rule.max);
      return 'bp.bpm >= ? AND bp.bpm <= ?';
    case 'source':
      if (rule.value === 'local') return "Song.id LIKE 'local:%'";
      if (rule.value === 'youtube') return "Song.id NOT LIKE 'local:%'";
      return 'EXISTS (SELECT 1 FROM Offline WHERE Offline.songId = Song.id)';
  }
}

const ORDER: Record<SmartSort, string> = {
  recent: '(ev.lastAt IS NULL), ev.lastAt DESC, Song.title COLLATE NOCASE',
  oldestPlayed: '(ev.lastAt IS NOT NULL), ev.lastAt ASC, Song.title COLLATE NOCASE',
  mostPlayed: 'COALESCE(ev.plays, 0) DESC, Song.title COLLATE NOCASE',
  leastPlayed: 'COALESCE(ev.plays, 0) ASC, Song.title COLLATE NOCASE',
  title: 'Song.title COLLATE NOCASE',
  added: 'Song.rowid DESC',
  bpm: '(bp.bpm IS NULL), bp.bpm ASC, Song.title COLLATE NOCASE',
  random: 'RANDOM()',
};

export function buildSmartQuery(rules: SmartRules, nowMs: number): { sql: string; params: SqlValue[] } {
  const params: SqlValue[] = [];
  const conds = rules.rules.map((r) => condition(r, nowMs, params));
  const where = conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(rules.match === 'any' ? ' OR ' : ' AND ')}` : '';
  params.push(Math.max(1, Math.min(MAX_LIMIT, Math.trunc(rules.limit) || DEFAULT_LIMIT)));
  const sql =
    'SELECT Song.* FROM Song ' +
    'LEFT JOIN (SELECT songId, COUNT(*) AS plays, MAX(timestamp) AS lastAt FROM Event GROUP BY songId) AS ev ON ev.songId = Song.id ' +
    'LEFT JOIN SongBpm AS bp ON bp.songId = Song.id ' +
    `${where} ORDER BY ${ORDER[rules.sort]} LIMIT ?`;
  return { sql, params };
}

/** one-line description for lists, e.g. "お気に入り・120日以上聞いていない" */
export function describeRules(r: SmartRules, tagName: (id: number) => string = (id) => `タグ${id}`): string {
  const parts = r.rules.map((q) => {
    switch (q.field) {
      case 'liked': return q.value ? 'お気に入り' : 'お気に入りでない';
      case 'tag': return `${q.op === 'has' ? '' : '「'}${tagName(q.tagId)}${q.op === 'has' ? 'タグあり' : '」タグなし'}`;
      case 'plays': return `${q.value}回${q.op === 'gte' ? '以上' : '以下'}再生`;
      case 'lastPlayed': return q.op === 'within' ? `${q.days}日以内に再生` : `${q.days}日以上聞いていない`;
      case 'artist': return `アーティスト「${q.value}」`;
      case 'title': return `曲名「${q.value}」`;
      case 'source': return { youtube: 'YouTube', local: '端末内', offline: 'オフライン保存' }[q.value];
      case 'bpm': return `BPM ${q.min}〜${q.max}`;
    }
  });
  return parts.length ? parts.join(r.match === 'any' ? ' または ' : '・') : 'すべての曲';
}
