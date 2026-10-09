import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KEY_ADVICE, MIN_KEY_LENGTH, checkSecretKey } from '../src/core/secretKey';

const problems = (k: string) => checkSecretKey(k).problems;

describe('the secret key rules', () => {
  it('good keys pass: a few words, with punctuation, Japanese, emoji, a long random string', () => {
    for (const k of ['purple-river-lamp-seven', 'ひとつ ふたつ みっつ よっつ', 'correct horse battery staple', 'Tr0ub4dor&3-and-more', '秘密の🔑キーは長くするべき', 'x7Kp2mQz9RvLw4Ns']) {
      assert.deepEqual(problems(k), [], k);
    }
  });
  it('too short is refused, and says how many letters there are (an emoji is one letter)', () => {
    assert.match(problems('abc-123-xyz')[0], /12文字以上.*いま 11文字/);
    assert.ok(checkSecretKey('seven-blue-lamps-x').ok);
    assert.equal(MIN_KEY_LENGTH, 12);
    assert.match(problems('🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑')[0], /いま 11文字/);
  });
  it('empty, spaces around, and control characters', () => {
    assert.deepEqual(problems(''), ['キーを入力してください']);
    assert.ok(problems(' purple-river-lamp ').some((p) => p.includes('前後の空白')));
    assert.ok(problems('purple-river\nlamp-seven').some((p) => p.includes('制御文字')));
    assert.ok(problems('purple-river\tlamp-seven').some((p) => p.includes('制御文字')));
  });
  it('digits only, a few different letters, repeated patterns', () => {
    assert.ok(problems('123456789012').some((p) => p.includes('数字だけ')));
    assert.ok(problems('1234 5678 9012').some((p) => p.includes('数字だけ')));
    assert.ok(problems('aaaaaaaaaaaaaaaa').some((p) => p.includes('同じ文字')));
    assert.ok(problems('abababababababab').some((p) => p.includes('同じ文字') || p.includes('繰り返し')));
    assert.ok(problems('abcabcabcabcabc').some((p) => p.includes('繰り返し')));
    assert.ok(problems('こんにちはこんにちはこんにちは').some((p) => p.includes('繰り返し')));
  });
  it('a common word on its own (or nearly) is refused; with real extra words it is fine', () => {
    for (const k of ['password1234', 'Password-12345', 'qwertyuiop123', 'iloveyou2026!', 'music-space-2026', 'パスワードパスワード']) assert.ok(problems(k).some((p) => p.includes('よくある言葉')), k);
    assert.deepEqual(problems('password-with-seven-blue-lamps'), []);
  });
  it('every problem is reported at once (so they can all be fixed in one go)', () => {
    const p = problems(' 1234 ');
    assert.ok(p.length >= 3, JSON.stringify(p));
  });
  it('advice is shown, and says what happens when the key is forgotten', () => {
    assert.ok(KEY_ADVICE.length >= 3);
    assert.ok(KEY_ADVICE.some((a) => a.includes('忘れる') && a.includes('開けません')));
  });
});
