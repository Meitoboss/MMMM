import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { configure, defaultConfig, getConfig } from '../src/core/config';
import { pickAudioFormat } from '../src/core/innertube/webpot';
import { MIN_SAVER_BITRATE, chooseByQuality, isAudioQuality, qualitiesFor } from '../src/core/streams/quality';
import { pickAudio } from '../src/core/streams/piped';

// what a typical YouTube Music video offers
const AAC48 = { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 48_800 };
const AAC128 = { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 129_500 };
const AAC256 = { itag: 141, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 256_000 }; // Premium, needs a login
const OPUS50 = { itag: 249, mimeType: 'audio/webm; codecs="opus"', bitrate: 51_000 };
const OPUS70 = { itag: 250, mimeType: 'audio/webm; codecs="opus"', bitrate: 70_000 };
const OPUS160 = { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160_000 };
const ALL = [AAC48, AAC128, OPUS50, OPUS70, OPUS160];
const itag = (x: { itag: number } | undefined) => x?.itag;

describe('audio quality', () => {
  afterEach(() => configure({ platform: defaultConfig.platform, quality: defaultConfig.quality }));

  it('the default is standard', () => {
    assert.equal(defaultConfig.quality, 'standard');
  });

  it('iPhone: standard = AAC 128, saver = AAC 48, "high" is the same as standard (AVPlayer plays only AAC)', () => {
    assert.equal(itag(chooseByQuality(ALL, 'standard', 'ios')), 140);
    assert.equal(itag(chooseByQuality(ALL, 'saver', 'ios')), 139);
    assert.equal(itag(chooseByQuality(ALL, 'high', 'ios')), 140);
  });

  it('Android: standard = AAC 128, saver = the smallest stream, high = the highest bitrate (Opus)', () => {
    assert.equal(itag(chooseByQuality(ALL, 'standard', 'android')), 140);
    assert.equal(itag(chooseByQuality(ALL, 'saver', 'android')), 139, '48.8 kbps AAC is smaller than 51 kbps Opus');
    assert.equal(itag(chooseByQuality(ALL, 'high', 'android')), 251);
  });

  it('a Premium 256 kbps stream, if the video offers it, is the top AAC', () => {
    assert.equal(itag(chooseByQuality([...ALL, AAC256], 'standard', 'ios')), 141);
    assert.equal(itag(chooseByQuality([...ALL, AAC256], 'saver', 'ios')), 139);
    assert.equal(itag(chooseByQuality([...ALL, AAC256], 'high', 'android')), 141, 'the highest bitrate of all');
  });

  it('a video without AAC: iPhone has nothing; Android takes what there is', () => {
    const webmOnly = [OPUS50, OPUS70, OPUS160];
    for (const q of ['standard', 'saver', 'high'] as const) assert.equal(chooseByQuality(webmOnly, q, 'ios'), undefined, `iOS ${q}`);
    assert.equal(itag(chooseByQuality(webmOnly, 'standard', 'android')), 251);
    assert.equal(itag(chooseByQuality(webmOnly, 'saver', 'android')), 249);
    assert.equal(itag(chooseByQuality(webmOnly, 'high', 'android')), 251);
  });

  it('a video that has only one stream: every quality takes it', () => {
    for (const q of ['standard', 'saver', 'high'] as const) assert.equal(itag(chooseByQuality([AAC128], q, 'ios')), 140);
  });

  it('"saver" ignores streams that are too small to be music, but takes the smallest there is if all are', () => {
    const tiny = { itag: 1, mimeType: 'audio/mp4', bitrate: MIN_SAVER_BITRATE - 1 };
    assert.equal(itag(chooseByQuality([tiny, AAC48, AAC128], 'saver', 'ios')), 139);
    assert.equal(itag(chooseByQuality([tiny, { itag: 2, mimeType: 'audio/mp4', bitrate: 20_000 }], 'saver', 'ios')), 2, 'nothing better: the smallest');
  });

  it('video, no mime type, broken bitrates and empty lists are never chosen', () => {
    assert.equal(chooseByQuality([], 'standard', 'ios'), undefined);
    assert.equal(chooseByQuality([{ itag: 18, mimeType: 'video/mp4', bitrate: 300_000 }], 'standard', 'android'), undefined);
    assert.equal(chooseByQuality([{ itag: 3, bitrate: 128_000 }], 'standard', 'android'), undefined);
    assert.equal(chooseByQuality([{ itag: 4, mimeType: 'audio/mp4', bitrate: Number.NaN }], 'standard', 'ios'), undefined);
    assert.equal(itag(chooseByQuality([{ itag: 4, mimeType: 'audio/mp4', bitrate: Number.NaN }, AAC128], 'standard', 'ios')), 140);
  });

  it('it does not change the list it is given', () => {
    const list = [...ALL];
    chooseByQuality(list, 'saver', 'android');
    assert.deepEqual(list.map((f) => f.itag), [139, 140, 249, 250, 251]);
  });

  it('only the choices that make sense are offered: no "高音質" on an iPhone', () => {
    assert.deepEqual(qualitiesFor('ios'), ['standard', 'saver']);
    assert.deepEqual(qualitiesFor('android'), ['standard', 'saver', 'high']);
    assert.ok(isAudioQuality('saver') && !isAudioQuality('ultra') && !isAudioQuality(undefined));
  });

  it('the setting reaches YouTube\'s own formats and the Piped fallback', () => {
    const formats = ALL.map((f) => ({ ...f, url: `u${f.itag}` }));
    assert.equal(getConfig().quality, 'standard');
    assert.equal(itag(pickAudioFormat(formats)), 140);
    configure({ quality: 'saver' });
    assert.equal(itag(pickAudioFormat(formats)), 139);
    assert.equal(pickAudio(formats.map((f) => ({ ...f, url: 'x' })))?.itag, 139);
    configure({ platform: 'android', quality: 'high' });
    assert.equal(itag(pickAudioFormat(formats)), 251);
  });
});
