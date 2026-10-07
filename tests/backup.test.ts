import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  BACKUP_APP, BACKUP_FORMAT, MAX_BACKUP_CHARS, RESTORABLE_SETTINGS, type BackupFile, backupFileName, describeSummary,
  isBackupFileName, parseBackup, pickSettings, summarizeBackup,
} from '../src/core/backup';
import { emptyRules } from '../src/core/smart';
import type { SongItem } from '../src/core/types';
import { describeReport, exportLibrary, importLibrary, previewImport } from '../src/db/backup';
import type { Db } from '../src/db/driver';
import * as repo from '../src/db/repo';
import { migrate } from '../src/db/schema';
import { nodeDb } from './helpers/nodeDb';

const song = (id: string, title = `T ${id}`, artist = 'Artist', extra: Partial<SongItem> = {}): SongItem => ({ kind: 'song', id, title, artists: [{ name: artist }], explicit: false, durationText: '3:30', thumbnail: `https://img/${id}.jpg`, ...extra });
const fresh = async () => {
  const db = nodeDb();
  await migrate(db);
  return db;
};
const exportJson = async (db: Db, events = true) => JSON.stringify(await exportLibrary(db, { events, appVersion: '1.0.1', now: new Date('2026-10-08T12:00:00Z') }));
const parsed = (text: string): BackupFile => {
  const r = parseBackup(text);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.backup;
};
const counts = async (db: Db) => {
  const n = async (t: string) => (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))!.n;
  return { Song: await n('Song'), Playlist: await n('Playlist'), SongPlaylistMap: await n('SongPlaylistMap'), Tag: await n('Tag'), SongTag: await n('SongTag'), SmartPlaylist: await n('SmartPlaylist'), HotCue: await n('HotCue'), SongTrim: await n('SongTrim'), SongBpm: await n('SongBpm'), Event: await n('Event') };
};

const BETA = song('b', 'Beta (explicit)', 'B', { explicit: true });

/** a library with a bit of everything */
async function fill(db: Db) {
  for (const s of [song('a', 'Alpha'), BETA, song('c', 'Gamma'), song('d', 'Delta')]) await repo.upsertSong(db, s);
  await repo.toggleLike(db, song('a', 'Alpha'));
  const mix = await repo.createPlaylist(db, 'ドライブ');
  await repo.addToPlaylist(db, mix, [song('c', 'Gamma'), song('a', 'Alpha'), BETA]); // an order that is not alphabetical
  await repo.createPlaylist(db, '空のプレイリスト');
  const night = await repo.createTag(db, '夜');
  const work = await repo.createTag(db, '作業用');
  await repo.setSongTag(db, song('a'), night, true);
  await repo.setSongTag(db, song('c'), night, true);
  await repo.setSongTag(db, song('c'), work, true);
  await repo.saveSmartPlaylist(db, { name: '夜の曲', rules: { ...emptyRules(), rules: [{ field: 'tag', op: 'has', tagId: night }, { field: 'liked', value: true }], match: 'all' } });
  await repo.saveSmartPlaylist(db, { name: '速い曲', rules: { ...emptyRules(), rules: [{ field: 'bpm', min: 140, max: 180 }] } });
  await repo.setHotCue(db, song('a'), 0, 12.5, 'サビ');
  await repo.setHotCue(db, song('a'), 3, 80);
  await repo.setTrim(db, song('c'), { startSec: 10, endSec: 150 });
  await repo.setBpm(db, song('a'), { bpm: 128, anchor: 0.42 });
  await repo.setBpm(db, song('d'), { bpm: 170 });
  for (let i = 0; i < 5; i++) await db.run('INSERT INTO Event (songId, timestamp, playTime) VALUES (?,?,?)', ['a', 1_700_000_000_000 + i * 1000, 60_000]);
  await db.run('UPDATE Song SET totalPlayTimeMs = 300000 WHERE id = ?', ['a']);
}

describe('writing the library out', () => {
  it('has everything, in a stable shape, and carries no files and no secrets', async () => {
    const db = await fresh();
    await fill(db);
    await repo.addLocalFile(db, { id: 'local:x', fileName: 'x.mp3', title: 'My file', artist: 'Me' });
    await repo.addToPlaylist(db, (await repo.playlists(db))[0].id, [song('local:x', 'My file')]);
    const b = await exportLibrary(db, { events: true, appVersion: '1.0.1', now: new Date('2026-10-08T12:00:00Z') });
    assert.equal(b.app, BACKUP_APP);
    assert.equal(b.format, BACKUP_FORMAT);
    assert.equal(b.createdAt, '2026-10-08T12:00:00.000Z');
    assert.equal(b.appVersion, '1.0.1');
    assert.deepEqual(b.songs.map((s) => s.id).sort(), ['a', 'b', 'c', 'd']);
    assert.ok(!JSON.stringify(b).includes('local:'), 'nothing about files on the phone');
    assert.deepEqual(b.playlists.find((p) => p.name === 'ドライブ')?.songs, ['c', 'a', 'b'], 'the order of a playlist is kept');
    assert.deepEqual(b.tags.find((t) => t.name === '夜')?.songs.sort(), ['a', 'c']);
    assert.equal(b.hotCues.length, 2);
    assert.equal(b.bpm.find((x) => x.songId === 'a')?.anchor, 0.42);
    assert.ok(!('anchor' in b.bpm.find((x) => x.songId === 'd')!));
    assert.equal(b.events.length, 5);
    assert.equal(b.songs.find((s) => s.id === 'b')?.title, 'e:Beta (explicit)', 'stored as in the database');
    assert.equal(b.settings, undefined);
  });

  it('a rule about a tag is written with the tag\'s NAME, not its number', async () => {
    const db = await fresh();
    await fill(db);
    const b = await exportLibrary(db, { events: false, appVersion: '1' });
    const rule = (b.smartPlaylists.find((s) => s.name === '夜の曲')!.rules as { rules: Record<string, unknown>[] }).rules[0];
    assert.deepEqual(rule, { field: 'tag', op: 'has', tagName: '夜' });
  });

  it('without history: only songs that something refers to; the history is left out', async () => {
    const db = await fresh();
    await fill(db);
    await repo.upsertSong(db, song('lonely', 'Played once, nothing else'));
    const without = await exportLibrary(db, { events: false, appVersion: '1' });
    assert.deepEqual(without.songs.map((s) => s.id).sort(), ['a', 'b', 'c', 'd'], 'the song nothing refers to is not carried');
    assert.equal(without.events.length, 0);
    const withHistory = await exportLibrary(db, { events: true, appVersion: '1' });
    assert.ok(withHistory.songs.some((s) => s.id === 'lonely'));
  });

  it('an empty library is a valid backup', async () => {
    const db = await fresh();
    const r = parseBackup(await exportJson(db));
    assert.ok(r.ok);
    assert.equal(r.ok && describeSummary(summarizeBackup(r.backup)), '0曲');
  });
});

describe('restoring: write out, read, put into another phone', () => {
  it('everything comes back – including the order of playlists, and tag numbers of a smart playlist that are different on the new phone', async () => {
    const a = await fresh();
    await fill(a);
    const file = await exportJson(a);

    const b = await fresh();
    // the new phone already has other tags, so the numbers cannot be the same
    await repo.createTag(b, '全然ちがうタグ');
    await repo.createTag(b, 'もう一つ');
    const report = await importLibrary(b, parsed(file));
    assert.equal(report.songsNew, 4);
    assert.equal(report.likedAdded, 1);
    assert.equal(report.playlistsNew, 2);
    assert.equal(report.eventsNew, 5);

    assert.deepEqual((await repo.playlistSongs(b, (await repo.playlists(b)).find((p) => p.name === 'ドライブ')!.id)).map((s) => s.id), ['c', 'a', 'b']);
    assert.equal((await repo.isLiked(b, 'a')), true);
    assert.equal((await repo.getSong(b, 'b'))?.explicit, true, 'the explicit marker survives');
    assert.deepEqual(await repo.hotCues(b, 'a'), [{ slot: 0, position: 12.5, label: 'サビ' }, { slot: 3, position: 80, label: undefined }]);
    assert.deepEqual(await repo.trimOf(b, 'c'), { startSec: 10, endSec: 150 });
    assert.deepEqual(await repo.bpmOf(b, 'a'), { bpm: 128, anchor: 0.42 });
    assert.equal((await db_first(b, 'SELECT totalPlayTimeMs AS t FROM Song WHERE id = ?', ['a'])).t, 300000);

    // the smart playlist works on the NEW phone's tag numbers
    const night = (await repo.tags(b)).find((t) => t.name === '夜')!;
    const smart = (await repo.smartPlaylists(b)).find((p) => p.name === '夜の曲')!;
    assert.deepEqual(smart.rules.rules[0], { field: 'tag', op: 'has', tagId: night.id });
    assert.deepEqual((await repo.smartSongs(b, smart.rules)).map((s) => s.id), ['a'], 'liked AND tagged 夜');
    const fast = (await repo.smartPlaylists(b)).find((p) => p.name === '速い曲')!;
    assert.deepEqual((await repo.smartSongs(b, fast.rules)).map((s) => s.id), ['d']);
  });

  it('writing it out again gives the same file (apart from the date)', async () => {
    const a = await fresh();
    await fill(a);
    const b = await fresh();
    await importLibrary(b, parsed(await exportJson(a)));
    const x = JSON.parse(await exportJson(a));
    const y = JSON.parse(await exportJson(b));
    for (const k of ['songs', 'playlists', 'tags', 'hotCues', 'trims', 'bpm']) {
      const sort = (v: { songId?: string; id?: string; name?: string }[]) => [...v].sort((p, q) => String(p.id ?? p.name ?? p.songId).localeCompare(String(q.id ?? q.name ?? q.songId)));
      assert.deepEqual(sort(y[k]), sort(x[k]), k);
    }
    assert.equal(y.events.length, x.events.length);
    assert.deepEqual(y.smartPlaylists.map((s: { name: string }) => s.name).sort(), x.smartPlaylists.map((s: { name: string }) => s.name).sort());
  });

  it('restoring the same file again changes nothing (it only ever adds)', async () => {
    const a = await fresh();
    await fill(a);
    const file = parsed(await exportJson(a));
    const b = await fresh();
    await importLibrary(b, file);
    const before = await counts(b);
    const again = await importLibrary(b, file);
    assert.deepEqual(await counts(b), before);
    assert.equal(again.songsNew + again.playlistsNew + again.tagsNew + again.smartNew + again.cuesNew + again.trimsNew + again.bpmNew + again.eventsNew + again.tagLinksAdded + again.playlistSongsAdded + again.likedAdded, 0);
    assert.deepEqual(describeReport(again), ['曲: 新しく 0曲（すでにある 4曲）', 'プレイリスト: 新しく 0、同じ名前のものへ追加 2（0曲を追加）', 'スマートプレイリスト: 新しく 0（同じものは 2）', 'タグ: 新しく 0、同じ名前 2（0曲に付与）']);
  });
});

async function db_first(db: Db, sql: string, p: (string | number)[]) {
  return (await db.first<Record<string, number>>(sql, p))!;
}

describe('restoring into a phone that already has things: nothing is lost', () => {
  it('same-name playlists get the missing songs at the END; others are untouched', async () => {
    const a = await fresh();
    await fill(a);
    const b = await fresh();
    const mix = await repo.createPlaylist(b, 'ドライブ');
    await repo.addToPlaylist(b, mix, [song('z', 'Zeta'), song('a', 'Alpha')]);
    const other = await repo.createPlaylist(b, '別のリスト');
    await repo.addToPlaylist(b, other, [song('z', 'Zeta')]);
    const report = await importLibrary(b, parsed(await exportJson(a)));
    assert.equal(report.playlistsMerged, 1);
    assert.equal(report.playlistSongsAdded, 2 + 0, 'c and b are new to it, a was already there');
    assert.deepEqual((await repo.playlistSongs(b, mix)).map((s) => s.id), ['z', 'a', 'c', 'b']);
    assert.deepEqual((await repo.playlistSongs(b, other)).map((s) => s.id), ['z']);
    assert.equal((await repo.playlists(b)).filter((p) => p.name === 'ドライブ').length, 1, 'no second playlist of the same name');
  });

  it('what you already have is kept: cues, start/end, tempo; a favourite is added; the longer listening time stays', async () => {
    const a = await fresh();
    await fill(a);
    const b = await fresh();
    await repo.upsertSong(b, song('a', 'Alpha'));
    await repo.setHotCue(b, song('a'), 0, 99, '自分のキュー');
    await repo.setBpm(b, song('a'), { bpm: 90 });
    await repo.setTrim(b, song('c', 'Gamma'), { startSec: 5 });
    await db_run(b, 'UPDATE Song SET totalPlayTimeMs = 900000 WHERE id = ?', ['a']);
    const report = await importLibrary(b, parsed(await exportJson(a)));
    assert.deepEqual((await repo.hotCues(b, 'a')).find((c) => c.slot === 0), { slot: 0, position: 99, label: '自分のキュー' });
    assert.equal((await repo.hotCues(b, 'a')).length, 2, 'but the other cue is added');
    assert.deepEqual(await repo.bpmOf(b, 'a'), { bpm: 90 });
    assert.deepEqual(await repo.trimOf(b, 'c'), { startSec: 5 });
    assert.equal(await repo.isLiked(b, 'a'), true, 'the favourite of the backup is added');
    assert.equal((await db_first(b, 'SELECT totalPlayTimeMs AS t FROM Song WHERE id = ?', ['a'])).t, 900000, 'the longer time is kept');
    assert.equal(report.cuesNew, 1);
    assert.equal(report.bpmNew, 1, 'only song d');
  });

  it('an unlike that you did on this phone is not undone for songs you have already unliked? – no: a favourite in the backup is added (documented), but never removed', async () => {
    const a = await fresh();
    await fill(a); // a is liked there
    const b = await fresh();
    await repo.upsertSong(b, BETA);
    await repo.toggleLike(b, BETA); // liked here, not in the backup
    await importLibrary(b, parsed(await exportJson(a)));
    assert.equal(await repo.isLiked(b, 'b'), true, 'nothing is removed');
    assert.equal(await repo.isLiked(b, 'a'), true);
  });

  it('a smart playlist with the same name: kept when the rules are the same, otherwise the new one comes in as "（取り込み）"', async () => {
    const a = await fresh();
    await fill(a);
    const b = await fresh();
    await repo.saveSmartPlaylist(b, { name: '速い曲', rules: { ...emptyRules(), rules: [{ field: 'bpm', min: 140, max: 180 }] } }); // the same
    await repo.saveSmartPlaylist(b, { name: '夜の曲', rules: { ...emptyRules(), rules: [{ field: 'liked', value: false }] } }); // other rules
    const report = await importLibrary(b, parsed(await exportJson(a)));
    const names = (await repo.smartPlaylists(b)).map((p) => p.name).sort();
    assert.deepEqual(names, ['夜の曲', '夜の曲（取り込み）', '速い曲'].sort());
    assert.equal(report.smartKept, 1);
    assert.equal(report.smartNew, 1);
    await importLibrary(b, parsed(await exportJson(a)));
    assert.equal((await repo.smartPlaylists(b)).length, 3, 'a second restore does not make "（取り込み）（取り込み）"');
  });

  it('tags are matched by name, letters ignored; links are added; tags that are not there are made', async () => {
    const a = await fresh();
    await fill(a);
    const b = await fresh();
    const mine = await repo.createTag(b, '作業用');
    await repo.upsertSong(b, song('q', 'Mine'));
    await repo.setSongTag(b, song('q'), mine, true);
    const report = await importLibrary(b, parsed(await exportJson(a)));
    assert.equal((await repo.tags(b)).length, 2);
    assert.equal(report.tagsNew, 1);
    assert.equal(report.tagsMerged, 1);
    assert.deepEqual((await repo.songsByTags(b, [mine], 'any')).map((s) => s.id).sort(), ['c', 'q']);
  });

  it('the same play event is not counted twice, even from another file', async () => {
    const a = await fresh();
    await fill(a);
    const b = await fresh();
    await importLibrary(b, parsed(await exportJson(a)));
    await db_run(b, 'INSERT INTO Event (songId, timestamp, playTime) VALUES (?,?,?)', ['a', 1_800_000_000_000, 1000]);
    const r = await importLibrary(b, parsed(await exportJson(a)));
    assert.equal(r.eventsNew, 0);
    assert.equal((await db_first(b, 'SELECT COUNT(*) AS n FROM Event', [])).n, 6);
  });
});

async function db_run(db: Db, sql: string, p: (string | number)[]) {
  await db.run(sql, p);
}

describe('the preview', () => {
  it('shows exactly what the restore will do, and changes nothing', async () => {
    const a = await fresh();
    await fill(a);
    const file = parsed(await exportJson(a));
    const b = await fresh();
    await repo.createPlaylist(b, 'ドライブ');
    await repo.createTag(b, '夜');
    const before = await counts(b);
    const preview = await previewImport(b, file);
    assert.deepEqual(await counts(b), before, 'not a row has changed');
    const real = await importLibrary(b, file);
    assert.deepEqual(real, preview, 'the numbers shown before are the numbers you get');
    assert.ok(preview.songsNew === 4 && preview.playlistsMerged === 1 && preview.tagsMerged === 1);
  });

  it('the preview can be run many times', async () => {
    const a = await fresh();
    await fill(a);
    const file = parsed(await exportJson(a));
    const b = await fresh();
    const x = await previewImport(b, file);
    const y = await previewImport(b, file);
    assert.deepEqual(x, y);
    assert.deepEqual(await counts(b), await counts(await fresh()));
  });
});

describe('a restore that fails half way changes nothing', () => {
  it('a broken entry (made past the reader) rolls everything back', async () => {
    const a = await fresh();
    await fill(a);
    const file = parsed(await exportJson(a));
    // the reader would never let this through; it is here to prove the all-or-nothing
    (file.events as unknown[]).push({ songId: 'a', timestamp: 'not a number', playTime: null });
    file.songs[file.songs.length - 1].title = null as unknown as string;
    const b = await fresh();
    await repo.createPlaylist(b, 'ここにあった');
    const before = await counts(b);
    await assert.rejects(() => importLibrary(b, file));
    assert.deepEqual(await counts(b), before, 'not even the songs that came before the broken one');
  });
});

describe('reading a file (it can come from anywhere)', () => {
  const good = (over: Record<string, unknown> = {}) => JSON.stringify({ app: BACKUP_APP, format: 1, createdAt: '2026-10-08T12:00:00Z', appVersion: '1.0.1', songs: [{ id: 'a', title: 'A' }], ...over });

  it('not JSON, empty, wrong app, newer format, too big: a clear reason', () => {
    const err = (t: string) => { const r = parseBackup(t); assert.ok(!r.ok); return r.ok ? '' : r.error; };
    assert.match(err(''), /空/);
    assert.match(err('{ not json'), /JSON/);
    assert.match(err('[]'), /バックアップではありません/);
    assert.match(err(JSON.stringify({ app: 'other', format: 1 })), /バックアップではありません/);
    assert.match(err(JSON.stringify({ app: BACKUP_APP })), /形式/);
    assert.match(err(good({ format: 99 })), /新しい版/);
    assert.match(err(good({ format: 0 })), /形式/);
    assert.match(err('x'.repeat(MAX_BACKUP_CHARS + 1)), /大きすぎ/);
  });

  it('a byte-order mark at the start (some editors add it) does no harm', () => {
    assert.ok(parseBackup(`\uFEFF${good()}`).ok);
  });

  it('wrong entries are dropped one by one, and the rest is kept; the user is told how many', () => {
    const r = parseBackup(good({
      songs: [{ id: 'a', title: 'A' }, { id: '', title: 'no id' }, { id: 'b' }, 5, null, { id: 'c', title: 'C', likedAt: 'yesterday', playMs: -5, thumbnail: 'javascript:alert(1)' }, { id: 'a', title: 'A again' }],
      playlists: [{ name: 'ok', songs: ['a', 'zzz', 'a', 5, 'c'] }, { name: '', songs: [] }, 'x'],
      hotCues: [{ songId: 'a', slot: 0, position: 5 }, { songId: 'a', slot: 8, position: 5 }, { songId: 'zzz', slot: 1, position: 5 }, { songId: 'a', slot: 0, position: 9 }, { songId: 'a', slot: 1, position: -1 }],
      bpm: [{ songId: 'a', bpm: 128 }, { songId: 'c', bpm: 5 }, { songId: 'a', bpm: 100 }],
      trims: [{ songId: 'a', startSec: 10, endSec: 10.2 }, { songId: 'c', startSec: 12 }],
      events: [{ songId: 'a', timestamp: 1, playTime: 1 }, { songId: 'a', timestamp: 0, playTime: 1 }, { songId: 'nope', timestamp: 5, playTime: 1 }],
    }));
    assert.ok(r.ok);
    const b = r.backup;
    assert.deepEqual(b.songs.map((s) => s.id), ['a', 'c']);
    assert.deepEqual(b.songs[1], { id: 'c', title: 'C', artists: null, duration: null, thumbnail: null, likedAt: null, playMs: 0 });
    assert.deepEqual(b.playlists, [{ name: 'ok', browseId: null, songs: ['a', 'c'] }], 'unknown, duplicate and non-text song ids are dropped');
    assert.deepEqual(b.hotCues, [{ songId: 'a', slot: 0, position: 5, label: null }]);
    assert.deepEqual(b.bpm, [{ songId: 'a', bpm: 128 }]);
    assert.deepEqual(b.trims, [{ songId: 'c', startSec: 12, endSec: null }]);
    assert.equal(b.events.length, 1);
    assert.ok(r.warnings.some((w) => /読み飛ばしました/.test(w)));
  });

  it('files on the phone are not restored, and the user is told', () => {
    const r = parseBackup(good({ songs: [{ id: 'a', title: 'A' }, { id: 'local:abc', title: 'My file' }], playlists: [{ name: 'p', songs: ['a', 'local:abc'] }] }));
    assert.ok(r.ok);
    assert.deepEqual(r.backup.songs.map((s) => s.id), ['a']);
    assert.deepEqual(r.backup.playlists[0].songs, ['a']);
    assert.ok(r.warnings.some((w) => w.includes('端末内のファイルの曲 1件')));
  });

  it('limits keep a huge or hostile file from eating the phone', () => {
    const many = Array.from({ length: 120_000 }, (_, i) => ({ id: `s${i}`, title: 't' }));
    const r = parseBackup(good({ songs: many }));
    assert.ok(r.ok && r.backup.songs.length === 100_000);
    const long = parseBackup(good({ songs: [{ id: 'a'.repeat(500), title: 'T'.repeat(5000), artists: 'x'.repeat(5000) }] }));
    assert.ok(long.ok && long.backup.songs[0].id.length === 100 && long.backup.songs[0].title.length === 300 && long.backup.songs[0].artists!.length === 500);
  });

  it('text is data: quotes and SQL in names are only text', async () => {
    const db = await fresh();
    const r = parseBackup(good({ songs: [{ id: "a'; DROP TABLE Song; --", title: "T'); DELETE FROM Playlist; --" }], playlists: [{ name: "'; DROP TABLE Playlist; --", songs: ["a'; DROP TABLE Song; --"] }] }));
    assert.ok(r.ok);
    await importLibrary(db, r.backup);
    assert.equal((await counts(db)).Song, 1);
    assert.equal((await repo.playlists(db))[0].name, "'; DROP TABLE Playlist; --");
  });

  it('a smart playlist rule from a file is checked like any other', async () => {
    const db = await fresh();
    const r = parseBackup(good({ smartPlaylists: [{ name: 'x', rules: { match: 'any', sort: 'DROP TABLE', limit: 'many', rules: [{ field: 'artist', value: "x' OR 1=1 --" }, { field: 'nope' }, { field: 'tag', op: 'has', tagName: '新しいタグ' }, { field: 'tag', op: 'has', tagName: '' }] } }] }));
    assert.ok(r.ok);
    await importLibrary(db, r.backup);
    const [p] = await repo.smartPlaylists(db);
    assert.equal(p.rules.sort, 'recent');
    assert.equal(p.rules.match, 'any');
    assert.deepEqual(p.rules.rules.map((x) => x.field), ['artist', 'tag']);
    assert.deepEqual((await repo.tags(db)).map((t) => t.name), ['新しいタグ'], 'the tag the rule needs is made');
  });

  it('a damaged smart playlist entry is dropped, not fatal', () => {
    const r = parseBackup(good({ smartPlaylists: [{ name: '', rules: {} }, { name: 'huge', rules: { x: 'y'.repeat(30_000) } }, 7] }));
    assert.ok(r.ok && r.backup.smartPlaylists.length === 0);
  });
});

describe('preferences in a backup', () => {
  it('only preferences go in; keys, servers and technical values never do', () => {
    const picked = pickSettings({
      audioQuality: 'saver', fadeSeconds: 4, playbackRate: 1.25, autoRadio: false, volumeNormalize: 'light', trendingCountry: 'kr', trendingLimit: 50, hl: 'ja', gl: 'JP',
      potServerKey: 'SECRET', streamServerKey: 'SECRET2', potServerUrl: 'https://x', streamServerUrl: 'https://y', updateFeedUrl: 'https://z', showDebug: true, webClientVersion: '1.2.3', pipedInstances: ['https://p'],
    });
    assert.deepEqual(Object.keys(picked).sort(), ['audioQuality', 'autoRadio', 'fadeSeconds', 'gl', 'hl', 'playbackRate', 'trendingCountry', 'trendingLimit', 'volumeNormalize']);
    for (const secret of ['potServerKey', 'streamServerKey', 'potServerUrl', 'streamServerUrl', 'updateFeedUrl', 'showDebug', 'webClientVersion', 'pipedInstances']) assert.ok(!(secret in RESTORABLE_SETTINGS), secret);
  });

  it('values of the wrong kind or range are dropped, also when they come from a file', () => {
    const r = parseBackup(JSON.stringify({ app: BACKUP_APP, format: 1, settings: { audioQuality: 'ultra', fadeSeconds: 99, playbackRate: 10, autoRadio: 'yes', trendingLimit: 30, trendingCountry: '../x', fadeSeconds2: 1, potServerKey: 'SECRET', playbackRate2: 1, volumeNormalize: 'light' } }));
    assert.ok(r.ok);
    assert.deepEqual(r.backup.settings, { volumeNormalize: 'light' });
    assert.ok(!JSON.stringify(r.backup).includes('SECRET'), 'a secret in a file is never read');
  });

  it('theme: the mode, and the colours you changed (dark and light apart) that are real colours', () => {
    const r = parseBackup(JSON.stringify({ app: BACKUP_APP, format: 1, theme: { mode: 'dark', overrides: { dark: { accent: '#82e653', bg: '#000', text: 'red', 'bad key!': '#ffffff', surface: '#112233aa', x: 5 }, light: { accent: '#336699' }, sepia: { accent: '#ffffff' } } } }));
    assert.ok(r.ok);
    assert.deepEqual(r.backup.theme, { mode: 'dark', overrides: { dark: { accent: '#82e653', surface: '#112233aa' }, light: { accent: '#336699' } } });
    for (const bad of ['DARK<script>', 'auto', 5, null]) {
      const none = parseBackup(JSON.stringify({ app: BACKUP_APP, format: 1, theme: { mode: bad, overrides: {} } }));
      assert.ok(none.ok && none.backup.theme === undefined, String(bad));
    }
  });
});

describe('names and numbers for the screen', () => {
  it('file names carry the date and time; any .json is offered for restoring', () => {
    assert.equal(backupFileName(new Date(2026, 9, 8, 7, 5)), 'musicspace-backup-20261008-0705.json');
    assert.ok(isBackupFileName('musicspace-backup-20261008-0705.json') && isBackupFileName('mine.JSON'));
    assert.ok(!isBackupFileName('song.mp3') && !isBackupFileName('notes.txt') && !isBackupFileName('x'.repeat(300) + '.json'));
  });
  it('the summary in words', () => {
    assert.equal(describeSummary({ songs: 120, playlists: 5, smartPlaylists: 2, tags: 3, hotCues: 10, bpm: 40, events: 900, settings: true }), '120曲・プレイリスト 5・スマート 2・タグ 3・キュー 10・BPM 40・再生履歴 900件・設定');
    assert.equal(describeSummary({ songs: 3, playlists: 0, smartPlaylists: 0, tags: 0, hotCues: 0, bpm: 0, events: 0, settings: false }), '3曲');
  });
  it('the report in words; nothing to add says so', () => {
    const empty = { songsNew: 0, songsKnown: 0, likedAdded: 0, playlistsNew: 0, playlistsMerged: 0, playlistSongsAdded: 0, smartNew: 0, smartKept: 0, tagsNew: 0, tagsMerged: 0, tagLinksAdded: 0, cuesNew: 0, trimsNew: 0, bpmNew: 0, eventsNew: 0 };
    assert.deepEqual(describeReport(empty), ['追加するものは、ありません（すべて、すでにあります）']);
    assert.ok(describeReport({ ...empty, songsNew: 80, songsKnown: 3, likedAdded: 12, eventsNew: 400 }).some((l) => l.includes('新しく 80曲')));
  });
});

describe('a library of a realistic size', () => {
  it('5 000 songs, 30 playlists and 40 000 plays are written and restored in a few seconds', async () => {
    const a = await fresh();
    await a.transaction(async () => {
      for (let i = 0; i < 5000; i++) await a.run('INSERT INTO Song (id, title, artistsText, durationText, thumbnailUrl, likedAt, totalPlayTimeMs) VALUES (?,?,?,?,?,?,?)', [`s${i}`, `Song ${i}`, `Artist ${i % 200}`, '3:30', `https://img/${i}.jpg`, i % 7 === 0 ? 1_700_000_000_000 + i : null, i * 100]);
      for (let p = 0; p < 30; p++) {
        const id = (await a.run('INSERT INTO Playlist (name, browseId) VALUES (?,?)', [`Playlist ${p}`, null])).lastInsertRowId;
        for (let k = 0; k < 100; k++) await a.run('INSERT INTO SongPlaylistMap (songId, playlistId, position) VALUES (?,?,?)', [`s${(p * 100 + k) % 5000}`, id, k]);
      }
      for (let e = 0; e < 40_000; e++) await a.run('INSERT INTO Event (songId, timestamp, playTime) VALUES (?,?,?)', [`s${e % 5000}`, 1_600_000_000_000 + e * 1000, 30_000]);
    });
    const t0 = Date.now();
    const text = await exportJson(a);
    const b = await fresh();
    const file = parsed(text);
    const preview = await previewImport(b, file);
    const report = await importLibrary(b, file);
    const ms = Date.now() - t0;
    assert.deepEqual(report, preview);
    assert.equal(report.songsNew, 5000);
    assert.equal(report.eventsNew, 40_000);
    assert.equal(report.playlistSongsAdded, 3000);
    assert.ok(ms < 30_000, `took ${ms} ms`);
    assert.ok(text.length < 15_000_000, `${(text.length / 1e6).toFixed(1)} MB`);
  });
});
