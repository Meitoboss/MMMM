import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ImportTrack,
  MATCH_SCORE,
  matchAll,
  matchTrack,
  normalize,
  parseCsv,
  parseDurationValue,
  parseTrackList,
  scoreCandidate,
  textSimilarity,
} from '../src/core/importer';
import type { MusicItem, SongItem } from '../src/core/types';

const song = (id: string, title: string, artist: string, durationSec?: number): SongItem => ({
  kind: 'song',
  id,
  title,
  artists: artist.split(',').map((name) => ({ name: name.trim() })),
  explicit: false,
  durationSec,
});

describe('CSV reading', () => {
  it('handles quotes, commas inside quotes, doubled quotes and newlines inside quotes', () => {
    const rows = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n');
    assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2']]);
  });
  it('copes with Windows line endings, a BOM, tabs and semicolons', () => {
    assert.deepEqual(parseCsv('\ufeffa,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  });
  it('ignores blank lines and keeps empty fields', () => {
    assert.deepEqual(parseCsv('a,b\n\n1,\n'), [['a', 'b'], ['1', '']]);
  });
});

describe('duration values', () => {
  it('reads ms, seconds and clock formats', () => {
    assert.equal(parseDurationValue('225000', true), 225);
    assert.equal(parseDurationValue('225000'), 225);
    assert.equal(parseDurationValue('225'), 225);
    assert.equal(parseDurationValue('3:45'), 225);
    assert.equal(parseDurationValue('1:02:03'), 3723);
    assert.equal(parseDurationValue(''), undefined);
    assert.equal(parseDurationValue('abc'), undefined);
  });
});

describe('reading a pasted list', () => {
  it('Exportify-style CSV: title, several artists, duration in ms', () => {
    const csv = [
      'Track URI,Track Name,Album Name,Artist Name(s),Duration (ms)',
      'spotify:track:1,"Bad Guy","WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",Billie Eilish,194088',
      'spotify:track:2,アイドル,【推しの子】,YOASOBI;Ayase,213000',
    ].join('\n');
    const t = parseTrackList(csv);
    assert.equal(t.length, 2);
    assert.deepEqual([t[0].title, t[0].artist, t[0].durationSec], ['Bad Guy', 'Billie Eilish', 194]);
    assert.equal(t[0].album, 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?');
    assert.deepEqual([t[1].title, t[1].artist, t[1].durationSec], ['アイドル', 'YOASOBI;Ayase', 213]);
  });

  it('Japanese column names', () => {
    const t = parseTrackList('曲名,アーティスト名\nアイドル,YOASOBI');
    assert.deepEqual([t[0].title, t[0].artist], ['アイドル', 'YOASOBI']);
  });

  it('a CSV with only a title column still works', () => {
    const t = parseTrackList('Title,Notes\nLemon,x\nPretender,y');
    assert.deepEqual(t.map((x) => x.title), ['Lemon', 'Pretender']);
  });

  it('plain lines: "Artist - Title", numbering, comments, blank lines', () => {
    const t = parseTrackList('# my list\n1. King Gnu - AIZO\n\n02) Official髭男dism – Pretender\nLemon\n1999');
    assert.equal(t.length, 4);
    assert.deepEqual([t[0].title, t[0].artist, t[0].swapOk], ['King Gnu', 'AIZO', true]);
    assert.deepEqual([t[1].title, t[1].artist], ['Official髭男dism', 'Pretender']);
    assert.deepEqual([t[2].title, t[2].artist], ['Lemon', undefined]);
    assert.equal(t[3].title, '1999', 'a title that starts with digits is left alone');
  });

  it('drops duplicates (same song, different spelling of case / punctuation)', () => {
    const t = parseTrackList('Title,Artist\nBad Guy,Billie Eilish\nbad guy,BILLIE EILISH\n"Bad  Guy!",Billie Eilish');
    assert.equal(t.length, 1);
  });

  it('empty input gives an empty list', () => {
    assert.deepEqual(parseTrackList('  \n '), []);
  });
});

describe('comparing text', () => {
  it('ignores case, brackets, punctuation, full-width forms and noise words', () => {
    assert.equal(normalize('Ｂａｄ Ｇｕｙ (Remastered 2019)'), 'badguy');
    assert.equal(normalize('Lemon [Official Video]'), 'lemon');
    assert.equal(normalize('Song feat. Someone'), 'songsomeone');
    assert.equal(normalize('「アイドル」'), 'アイドル');
    assert.equal(normalize('（only brackets）'), 'onlybrackets', 'brackets are kept when nothing else is left');
  });
  it('similarity: identical, contained, close, different', () => {
    assert.equal(textSimilarity('Bad Guy', 'bad guy (Remastered)'), 1);
    assert.ok(textSimilarity('Pretender', 'Pretender - Official髭男dism') > 0.75);
    assert.ok(textSimilarity('Lemon', 'Lemons') > 0.5);
    assert.ok(textSimilarity('Lemon', 'Pretender') < 0.2);
    assert.equal(textSimilarity('', 'x'), 0);
  });
  it('works for Japanese text without spaces', () => {
    assert.ok(textSimilarity('夜に駆ける', '夜に駆ける') === 1);
    assert.ok(textSimilarity('夜に駆ける', '夜に駆けるカラオケ') > 0.75);
    assert.ok(textSimilarity('夜に駆ける', '怪物') < 0.2);
  });
});

describe('scoring candidates', () => {
  const track: ImportTrack = { title: 'Bad Guy', artist: 'Billie Eilish', durationSec: 194, raw: '' };

  it('the right song scores high, a different artist or title scores low', () => {
    const right = scoreCandidate(track, song('1', 'bad guy', 'Billie Eilish', 194));
    const wrongArtist = scoreCandidate(track, song('2', 'bad guy', 'Some Cover Band', 194));
    const wrongSong = scoreCandidate(track, song('3', 'Happier Than Ever', 'Billie Eilish', 194));
    assert.ok(right.score > 0.95);
    assert.ok(wrongArtist.score < right.score - 0.2);
    assert.ok(wrongSong.score < 0.6);
  });

  it('a very different length lowers the score', () => {
    const near = scoreCandidate(track, song('1', 'bad guy', 'Billie Eilish', 195)).score;
    const far = scoreCandidate(track, song('2', 'bad guy', 'Billie Eilish', 400)).score;
    assert.ok(near > far);
  });

  it('karaoke / instrumental versions are pushed down unless wanted', () => {
    const normal = scoreCandidate(track, song('1', 'Bad Guy', 'Billie Eilish', 194)).score;
    const karaoke = scoreCandidate(track, song('2', 'Bad Guy (Karaoke Version)', 'Billie Eilish', 194)).score;
    assert.ok(karaoke < normal * 0.85);
    const wanted = scoreCandidate({ ...track, title: 'Bad Guy (Karaoke)' }, song('3', 'Bad Guy (Karaoke Version)', 'Billie Eilish')).score;
    assert.ok(wanted > 0.7);
  });

  it('several artists: any of them counts', () => {
    const t: ImportTrack = { title: 'アイドル', artist: 'YOASOBI;Ayase', raw: '' };
    const s = scoreCandidate(t, song('1', 'アイドル', 'YOASOBI'));
    assert.ok(s.score > 0.95);
  });

  it('plain "A - B" lines may be in either order', () => {
    const t: ImportTrack = { title: 'AIZO', artist: 'King Gnu', raw: '', swapOk: true }; // really "title - artist"
    assert.ok(scoreCandidate(t, song('1', 'AIZO', 'King Gnu')).score > 0.95);
    const swapped: ImportTrack = { title: 'King Gnu', artist: 'AIZO', raw: '', swapOk: true }; // "artist - title"
    assert.ok(scoreCandidate(swapped, song('1', 'AIZO', 'King Gnu')).score > 0.95);
  });
});

describe('matching against a search', () => {
  const catalog = (map: Record<string, MusicItem[]>) => async (q: string) => map[q] ?? [];
  const track: ImportTrack = { title: 'Bad Guy', artist: 'Billie Eilish', durationSec: 194, raw: '' };

  it('a sure hit needs only one search', async () => {
    let searches = 0;
    const r = await matchTrack(track, async () => {
      searches++;
      return [song('1', 'bad guy', 'Billie Eilish', 194), song('2', 'Bad Guy (Karaoke)', 'X', 190)];
    });
    assert.equal(r.status, 'matched');
    assert.equal(r.best?.id, '1');
    assert.equal(searches, 1);
    assert.ok(r.score >= MATCH_SCORE);
  });

  it('unsure hits are offered as candidates, best first', async () => {
    const r = await matchTrack(track, catalog({ 'Billie Eilish Bad Guy': [song('9', 'Bad Guy', 'Cover Band'), song('8', 'Bad Boy', 'Billie Eilish')] }));
    assert.equal(r.status, 'maybe');
    assert.equal(r.candidates[0].song.id, '9');
    assert.ok(r.candidates.length <= 5);
  });

  it('a second search (title only) finds what the first missed; non-songs are ignored', async () => {
    const video = { kind: 'video', id: 'v', title: 'Bad Guy', artists: [{ name: 'Billie Eilish' }], explicit: false } as unknown as MusicItem;
    const r = await matchTrack(track, catalog({ 'Billie Eilish Bad Guy': [video], 'Bad Guy': [song('1', 'Bad Guy', 'Billie Eilish', 194)] }));
    assert.equal(r.status, 'matched');
    assert.equal(r.best?.id, '1');
  });

  it('nothing found', async () => {
    const r = await matchTrack(track, async () => []);
    assert.deepEqual([r.status, r.best, r.candidates.length], ['none', undefined, 0]);
  });

  it('a search error on one track does not stop the others', async () => {
    const tracks: ImportTrack[] = [
      { title: 'A', artist: 'X', raw: '' },
      { title: 'BOOM', artist: 'X', raw: '' },
      { title: 'C', artist: 'X', raw: '' },
    ];
    const progress: number[] = [];
    const results = await matchAll(
      tracks,
      async (q) => {
        if (q.includes('BOOM')) throw new Error('HTTP 429');
        return [song(q, q.split(' ')[1], 'X')];
      },
      { delayMs: 0, onProgress: (d) => progress.push(d) },
    );
    assert.deepEqual(results.map((r) => r.track.title), ['A', 'BOOM', 'C'], 'order is kept');
    assert.equal(results[1].status, 'none');
    assert.match(results[1].error ?? '', /429/);
    assert.deepEqual(progress.slice().sort(), [1, 2, 3]);
  });

  it('runs a few searches at once but never more than asked', async () => {
    let active = 0;
    let peak = 0;
    const tracks = Array.from({ length: 12 }, (_, i) => ({ title: `T${i}`, raw: '' }));
    await matchAll(
      tracks,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return [];
      },
      { concurrency: 3, delayMs: 0 },
    );
    assert.ok(peak > 1 && peak <= 3, `peak ${peak}`);
  });

  it('can be cancelled part-way', async () => {
    let cancelled = false;
    const tracks = Array.from({ length: 30 }, (_, i) => ({ title: `T${i}`, raw: '' }));
    const results = await matchAll(tracks, async () => [], {
      concurrency: 1,
      delayMs: 0,
      isCancelled: () => cancelled,
      onProgress: (done) => {
        if (done === 5) cancelled = true;
      },
    });
    assert.ok(results.length >= 5 && results.length < 30);
  });
});
