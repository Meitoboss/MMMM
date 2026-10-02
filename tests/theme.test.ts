import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contrast, darken, hexToRgb, luminance, mix, normalizeHex, readableOn, rgbToHex } from '../src/core/color';
import { PRESETS, palettes, resolvePalette, sanitizeOverrides } from '../src/core/themeLogic';

describe('colour helpers', () => {
  it('normalizes hex input and rejects garbage', () => {
    assert.equal(normalizeHex('#82E653'), '#82e653');
    assert.equal(normalizeHex('  82e653 '), '#82e653');
    assert.equal(normalizeHex('#8e5'), '#88ee55');
    for (const bad of ['', '#', '#12', '#12345', '#1234567', 'zzzzzz', '#12345g', 'red', '#ff 00ff']) assert.equal(normalizeHex(bad), null, bad);
  });
  it('converts between hex and rgb', () => {
    assert.deepEqual(hexToRgb('#82e653'), { r: 130, g: 230, b: 83 });
    assert.equal(rgbToHex({ r: 130, g: 230, b: 83 }), '#82e653');
    assert.equal(rgbToHex({ r: 300, g: -5, b: 0.4 }), '#ff0000');
    assert.deepEqual(hexToRgb('nonsense'), { r: 0, g: 0, b: 0 });
  });
  it('luminance and contrast follow WCAG', () => {
    assert.equal(luminance('#000000'), 0);
    assert.equal(luminance('#ffffff'), 1);
    assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
    assert.equal(contrast('#777777', '#777777'), 1);
  });
  it('picks readable text for any accent', () => {
    assert.equal(readableOn('#82e653'), '#0b0c10'); // lime → dark ink
    assert.equal(readableOn('#ffffff'), '#0b0c10');
    assert.equal(readableOn('#1a237e'), '#ffffff'); // dark blue → white
    assert.equal(readableOn('#000000'), '#ffffff');
  });
  it('mixes and darkens', () => {
    assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
    assert.equal(mix('#102030', '#102030', 0.7), '#102030');
    assert.equal(darken('#ffffff', 0.5), '#808080');
    assert.equal(darken('#82e653', 0), '#82e653');
  });
});

describe('theme logic', () => {
  it('keeps only valid saved colours (a damaged save cannot break the app)', () => {
    assert.deepEqual(sanitizeOverrides(null), {});
    assert.deepEqual(sanitizeOverrides('x'), {});
    assert.deepEqual(sanitizeOverrides({ dark: { accent: '#FF7AB6', bg: 'not a colour', nonsense: '#000000' }, light: 7, other: {} }), { dark: { accent: '#ff7ab6' } });
    assert.deepEqual(sanitizeOverrides({ dark: { bg: 12 } }), {});
  });
  it('without overrides it is exactly the base palette', () => {
    assert.deepEqual(resolvePalette('dark'), palettes.dark);
    assert.deepEqual(resolvePalette('light', {}), palettes.light);
  });
  it('a custom accent drags its text and on-accent colours along', () => {
    const dark = resolvePalette('dark', { accent: '#ff7ab6' });
    assert.equal(dark.accentText, '#ff7ab6');
    assert.equal(dark.onAccent, '#0b0c10');
    const light = resolvePalette('light', { accent: '#1a237e' });
    assert.equal(light.onAccent, '#ffffff');
    assert.notEqual(light.accentText, '#1a237e'); // darkened for use as text on white
    // an explicit accentText wins
    assert.equal(resolvePalette('dark', { accent: '#ff7ab6', accentText: '#ffffff' }).accentText, '#ffffff');
  });
  it('every preset uses valid colours and a known mode', () => {
    assert.ok(PRESETS.length >= 6);
    assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
    for (const p of PRESETS) {
      assert.ok(p.scheme === 'dark' || p.scheme === 'light', p.id);
      for (const v of Object.values(p.colors)) assert.ok(normalizeHex(v as string), `${p.id}: ${v}`);
      // text must stay readable on the preset's background
      const r = resolvePalette(p.scheme, p.colors);
      assert.ok(contrast(r.text, r.bg) >= 7, `${p.id}: text/background contrast`);
      assert.ok(contrast(r.onAccent, r.accent) >= 4.5, `${p.id}: on-accent contrast`);
    }
  });
});
