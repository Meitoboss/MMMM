import Storage from 'expo-sqlite/kv-store';
import { Appearance, StyleSheet } from 'react-native';
import { create } from 'zustand';

import { normalizeHex } from '../core/color';
import {
  Overrides,
  Palette,
  Preset,
  Scheme,
  ThemeMode,
  palettes,
  resolvePalette,
  sanitizeOverrides,
} from '../core/themeLogic';

export type { Overrides, Palette, Preset, Scheme, ThemeMode };
export { ACCENT_SWATCHES, EDITABLE, PRESETS, palettes } from '../core/themeLogic';

const MODE_KEY = 'theme.v1';
const OVERRIDES_KEY = 'theme.overrides.v1';

function resolveScheme(mode: ThemeMode): Scheme {
  if (mode === 'system') return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  return mode;
}

function loadMode(): ThemeMode {
  try {
    const v = Storage.getItemSync(MODE_KEY);
    return v === 'light' || v === 'system' || v === 'dark' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

function loadOverrides(): Overrides {
  try {
    const raw = Storage.getItemSync(OVERRIDES_KEY);
    return raw ? sanitizeOverrides(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function persist(key: string, value: string) {
  try {
    Storage.setItemSync(key, value);
  } catch {
    /* not saved – the theme still applies until the app closes */
  }
}

const initialMode = loadMode();
let currentScheme: Scheme = resolveScheme(initialMode);
let overrides: Overrides = loadOverrides();
let resolved: Record<Scheme, Palette> = {
  dark: resolvePalette('dark', overrides.dark),
  light: resolvePalette('light', overrides.light),
};
/** bumped whenever the colours change, so cached styles are rebuilt */
let version = 0;

function rebuild() {
  resolved = { dark: resolvePalette('dark', overrides.dark), light: resolvePalette('light', overrides.light) };
  version += 1;
}

interface ThemeStore {
  mode: ThemeMode;
  scheme: Scheme;
  /** changes whenever a colour changes */
  version: number;
  overrides: Overrides;
  setMode: (m: ThemeMode) => void;
  refresh: () => void;
  /** set (hex) or clear (null) one colour of one mode; returns false for an invalid colour */
  setColor: (scheme: Scheme, key: keyof Palette, value: string | null) => boolean;
  /** replaces the colours of the preset's mode and switches to that mode */
  applyPreset: (preset: Preset) => void;
  resetColors: (scheme: Scheme) => void;
}

export const useTheme = create<ThemeStore>((set, get) => {
  const commit = (extra: Partial<ThemeStore> = {}) => {
    persist(OVERRIDES_KEY, JSON.stringify(overrides));
    rebuild();
    set({ overrides, version, ...extra });
  };
  return {
    mode: initialMode,
    scheme: currentScheme,
    version,
    overrides,
    setMode: (mode) => {
      persist(MODE_KEY, mode);
      currentScheme = resolveScheme(mode);
      set({ mode, scheme: currentScheme });
    },
    refresh: () => {
      const next = resolveScheme(get().mode);
      if (next !== currentScheme) {
        currentScheme = next;
        set({ scheme: next });
      }
    },
    setColor: (scheme, key, value) => {
      const next: Partial<Palette> = { ...(overrides[scheme] ?? {}) };
      if (value === null) {
        delete next[key];
      } else {
        const hex = normalizeHex(value);
        if (!hex) return false;
        next[key] = hex;
      }
      overrides = { ...overrides, [scheme]: next };
      commit();
      return true;
    },
    applyPreset: (preset) => {
      overrides = { ...overrides, [preset.scheme]: { ...preset.colors } };
      persist(MODE_KEY, preset.scheme);
      currentScheme = preset.scheme;
      commit({ mode: preset.scheme, scheme: preset.scheme });
    },
    resetColors: (scheme) => {
      overrides = { ...overrides, [scheme]: {} };
      commit();
    },
  };
});

Appearance.addChangeListener(() => useTheme.getState().refresh());

/** Components call this so they re-render when the mode OR any colour changes. */
export function useScheme(): Scheme {
  useTheme((s) => s.version);
  return useTheme((s) => s.scheme);
}

/** The colours of the current theme, as a ready-to-use object (e.g. for the editor's own rows). */
export function currentPalette(): Palette {
  return resolved[currentScheme];
}

/**
 * `colors.text` etc. always return the colour of the CURRENT theme at the moment of reading
 * (i.e. at render time). Components that read it must also call `useScheme()`.
 * Plain getters (no Proxy): Hermes' Proxy support is not something to build the whole UI on.
 */
export const colors = {} as Palette;
for (const key of Object.keys(palettes.dark) as (keyof Palette)[]) {
  Object.defineProperty(colors, key, { get: () => resolved[currentScheme][key], enumerable: true });
}

/** StyleSheet whose values follow the theme (rebuilt when the mode or a colour changes, otherwise cached). */
export function dynamicStyles<T extends Record<string, object>>(factory: (c: Palette) => T): T {
  const cache: Partial<Record<Scheme, { v: number; styles: T }>> = {};
  const current = (): T => {
    const scheme = currentScheme;
    const hit = cache[scheme];
    if (hit && hit.v === version) return hit.styles;
    const styles = StyleSheet.create(factory(resolved[scheme])) as T;
    cache[scheme] = { v: version, styles };
    return styles;
  };
  const out = {} as T;
  for (const key of Object.keys(current()) as (keyof T)[]) {
    Object.defineProperty(out, key, { get: () => current()[key], enumerable: true });
  }
  return out;
}

export const TAB_HEIGHT = 56;
export const MINI_HEIGHT = 64;
