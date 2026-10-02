import { darken, normalizeHex, readableOn } from './color';

/**
 * Music space theme: palettes, user overrides and presets – pure data and functions (no React Native),
 * so they can be tested. Tokens follow the web version (dark #0b0c10 with the lime accent #82e653).
 */
export interface Palette {
  bg: string;
  /** cards, rows on press */
  surface: string;
  /** inputs, chips, hover */
  surface2: string;
  text: string;
  sub: string;
  accent: string;
  /** accent used for TEXT/ICONS (the lime is too light to read on white) */
  accentText: string;
  /** text/icon colour on top of an accent-coloured fill */
  onAccent: string;
  danger: string;
  border: string;
  /** dimmed lyric lines */
  dim: string;
}

export const palettes = {
  dark: {
    bg: '#0b0c10',
    surface: '#161b22',
    surface2: '#21262d',
    text: '#ffffff',
    sub: '#8f9499',
    accent: '#82e653',
    accentText: '#82e653',
    onAccent: '#0b0c10',
    danger: '#ff6b6b',
    border: '#1f232b',
    dim: '#4a5058',
  },
  light: {
    bg: '#f4f5f7',
    surface: '#ffffff',
    surface2: '#eaeaea',
    text: '#1f232b',
    sub: '#656d76',
    accent: '#82e653',
    accentText: '#3d8f16',
    onAccent: '#0b0c10',
    danger: '#d93025',
    border: '#e1e4e8',
    dim: '#b4bac1',
  },
} satisfies Record<string, Palette>;

export type Scheme = keyof typeof palettes;
export type ThemeMode = Scheme | 'system';
export type Overrides = Partial<Record<Scheme, Partial<Palette>>>;

/** colours the editor lets the user change */
export const EDITABLE: { key: keyof Palette; label: string }[] = [
  { key: 'accent', label: 'アクセント' },
  { key: 'bg', label: '背景' },
  { key: 'surface', label: 'カード' },
  { key: 'surface2', label: '入力欄・チップ' },
  { key: 'text', label: '文字' },
  { key: 'sub', label: '補助の文字' },
];

export const ACCENT_SWATCHES = ['#82e653', '#3ee0a8', '#4cc2ff', '#6ea8ff', '#a78bfa', '#ff7ab6', '#ff6b6b', '#ffb347', '#ffffff'];

const PALETTE_KEYS = Object.keys(palettes.dark) as (keyof Palette)[];

/** Keeps only known keys with valid colours (a hand-edited or damaged save can never break the app). */
export function sanitizeOverrides(raw: unknown): Overrides {
  const out: Overrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const scheme of ['dark', 'light'] as const) {
    const src = (raw as Record<string, unknown>)[scheme];
    if (!src || typeof src !== 'object') continue;
    const clean: Partial<Palette> = {};
    for (const key of PALETTE_KEYS) {
      const v = (src as Record<string, unknown>)[key];
      const hex = typeof v === 'string' ? normalizeHex(v) : null;
      if (hex) clean[key] = hex;
    }
    if (Object.keys(clean).length) out[scheme] = clean;
  }
  return out;
}

/** base palette + overrides; when only the accent is overridden its text / on-accent colours follow it */
export function resolvePalette(scheme: Scheme, overrides: Partial<Palette> = {}): Palette {
  const p: Palette = { ...palettes[scheme], ...overrides };
  if (overrides.accent) {
    if (!overrides.accentText) p.accentText = scheme === 'dark' ? overrides.accent : darken(overrides.accent, 0.35);
    if (!overrides.onAccent) p.onAccent = readableOn(overrides.accent);
  }
  return p;
}

export interface Preset {
  id: string;
  label: string;
  scheme: Scheme;
  /** empty = the standard colours of that mode */
  colors: Partial<Palette>;
}

export const PRESETS: Preset[] = [
  { id: 'standard-dark', label: '標準（ダーク）', scheme: 'dark', colors: {} },
  { id: 'black', label: 'ブラック', scheme: 'dark', colors: { bg: '#000000', surface: '#0d0d0d', surface2: '#1a1a1a', border: '#1a1a1a' } },
  { id: 'midnight', label: 'ミッドナイト', scheme: 'dark', colors: { bg: '#0a1020', surface: '#121a30', surface2: '#1b2644', border: '#1d2a4a', accent: '#6ea8ff' } },
  { id: 'forest', label: 'フォレスト', scheme: 'dark', colors: { bg: '#0a110c', surface: '#121c15', surface2: '#1b2a20', border: '#1f3026', accent: '#5fe08a' } },
  { id: 'rose', label: 'ローズ', scheme: 'dark', colors: { bg: '#140b10', surface: '#1f1218', surface2: '#2c1a23', border: '#33202a', accent: '#ff7ab6' } },
  { id: 'sunset', label: 'サンセット', scheme: 'dark', colors: { bg: '#14100b', surface: '#1f1912', surface2: '#2c2418', border: '#33291b', accent: '#ffb347' } },
  { id: 'standard-light', label: '標準（ライト）', scheme: 'light', colors: {} },
  { id: 'mint', label: 'ミント', scheme: 'light', colors: { bg: '#eef7f1', surface: '#ffffff', surface2: '#dcecdf', border: '#d3e6d8', accent: '#3ee08a' } },
  { id: 'sky', label: 'スカイ', scheme: 'light', colors: { bg: '#eef4fb', surface: '#ffffff', surface2: '#dde8f5', border: '#d3e0f0', accent: '#4c9bff' } },
];
