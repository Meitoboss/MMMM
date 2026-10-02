import Storage from 'expo-sqlite/kv-store';
import { Appearance, StyleSheet } from 'react-native';
import { create } from 'zustand';

/**
 * Music space theme.
 * Tokens follow the web version (Music space – Pro Edition): dark #0b0c10 with the lime accent #82e653,
 * plus the light theme from the same stylesheet.
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

const KEY = 'theme.v1';

function resolve(mode: ThemeMode): Scheme {
  if (mode === 'system') return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  return mode;
}

function loadMode(): ThemeMode {
  try {
    const v = Storage.getItemSync(KEY);
    return v === 'light' || v === 'system' || v === 'dark' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

const initialMode = loadMode();
let currentScheme: Scheme = resolve(initialMode);

interface ThemeStore {
  mode: ThemeMode;
  scheme: Scheme;
  setMode: (m: ThemeMode) => void;
  refresh: () => void;
}

export const useTheme = create<ThemeStore>((set, get) => ({
  mode: initialMode,
  scheme: currentScheme,
  setMode: (mode) => {
    try {
      Storage.setItemSync(KEY, mode);
    } catch {
      /* not persisted */
    }
    currentScheme = resolve(mode);
    set({ mode, scheme: currentScheme });
  },
  refresh: () => {
    const next = resolve(get().mode);
    if (next !== currentScheme) {
      currentScheme = next;
      set({ scheme: next });
    }
  },
}));

Appearance.addChangeListener(() => useTheme.getState().refresh());

/** Components call this so they re-render when the theme changes. */
export function useScheme(): Scheme {
  return useTheme((s) => s.scheme);
}

/**
 * `colors.text` etc. always return the colour of the CURRENT theme at the moment of reading
 * (i.e. at render time). Components that read it must also call `useScheme()`.
 * Plain getters (no Proxy): Hermes' Proxy support is not something to build the whole UI on.
 */
export const colors = {} as Palette;
for (const key of Object.keys(palettes.dark) as (keyof Palette)[]) {
  Object.defineProperty(colors, key, { get: () => palettes[currentScheme][key], enumerable: true });
}

/** StyleSheet whose values follow the theme (rebuilt once per scheme, then cached). */
export function dynamicStyles<T extends Record<string, object>>(factory: (c: Palette) => T): T {
  const cache: Partial<Record<Scheme, T>> = {};
  const current = (): T => {
    const scheme = currentScheme;
    cache[scheme] ??= StyleSheet.create(factory(palettes[scheme])) as T;
    return cache[scheme] as T;
  };
  const out = {} as T;
  for (const key of Object.keys(current()) as (keyof T)[]) {
    Object.defineProperty(out, key, { get: () => current()[key], enumerable: true });
  }
  return out;
}

export const TAB_HEIGHT = 56;
export const MINI_HEIGHT = 64;
