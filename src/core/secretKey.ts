/**
 * The rules for the secret key of a song archive. The key is the only protection of the file – and nobody can open the file
 * without it (not even us) – so it has to be long enough to resist guessing, and it must be possible to type it again exactly.
 */
export const MIN_KEY_LENGTH = 12;

export interface KeyCheck {
  ok: boolean;
  /** what is wrong, in words (empty when ok) */
  problems: string[];
}

const length = (s: string): number => Array.from(s).length; // letters, not UTF-16 units: an emoji is one

/** words that are tried first by anyone guessing; a key that is little more than one of these is refused */
const COMMON = ['password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfgh', 'letmein', 'iloveyou', 'welcome', 'admin', 'login', 'abcdef', 'abc123', 'monkey', 'dragon', 'master', 'sunshine', 'football', 'baseball', 'musicspace', 'music-space', 'youtube', 'secretkey', 'secret', 'himitsu', 'ひみつ', 'パスワード', 'ぱすわーど', 'あいうえお', 'アイウエオ'];

export function checkSecretKey(key: string): KeyCheck {
  const problems: string[] = [];
  if (key.length === 0) return { ok: false, problems: ['キーを入力してください'] };
  if (key !== key.trim()) problems.push('前後の空白は使えません（見えない違いで、あとから開けなくなります）');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(key)) problems.push('改行や制御文字は使えません');
  const n = length(key);
  if (n < MIN_KEY_LENGTH) problems.push(`${MIN_KEY_LENGTH}文字以上にしてください（いま ${n}文字）`);
  if (/^[0-9\s]+$/.test(key)) problems.push('数字だけのキーは使えません');
  if (new Set(Array.from(key)).size < 6) problems.push('同じ文字が多すぎます（6種類以上の文字を使ってください）');
  const plain = key.toLowerCase().replace(/[\s_\-.,!?]/g, '');
  const squash = (w: string) => w.toLowerCase().replace(/[\s_\-.]/g, '');
  const common = COMMON.some((w) => plain.includes(squash(w)) && length(plain) <= length(squash(w)) + 6);
  if (common) problems.push('よくある言葉が、ほとんどを占めています。別の言葉を足すか、ほかの言葉にしてください');
  if (/^(.{1,8})\1+$/.test(plain)) problems.push('同じ並びの繰り返しです');
  return { ok: problems.length === 0, problems };
}

/** a few words and a bit of punctuation are easy to remember and hard to guess */
export const KEY_ADVICE = [
  '覚えやすく、推測されにくいのは、関係のない言葉を4つ以上つなげたものです（例: 好きな言葉を、記号でつなぐ）。',
  '半角の英数字と記号が、おすすめです（機種によって、全角の文字の扱いが少し違うことがあります）。',
  'パスワード管理アプリなどに、必ず控えてください。キーを忘れると、誰にも、ファイルを開けません。',
];
