/**
 * Small colour helpers for the theme editor.
 * Written without regular expressions on purpose: these run while the app starts (saved colours are checked on launch).
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_DIGITS = '0123456789abcdef';
const clamp255 = (v: number) => Math.max(0, Math.min(255, v));

/** "#82E653", "82e653" or "#8e5" → "#82e653"; anything else → null */
export function normalizeHex(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6) return null;
  for (const ch of s) if (!HEX_DIGITS.includes(ch)) return null;
  return `#${s}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex) ?? '#000000';
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(clamp255(v)).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance, 0 (black) … 1 (white) */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 … 21 */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** mix `a` with `b`; t = 0 → a, t = 1 → b */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

export const darken = (hex: string, amount: number): string => mix(hex, '#000000', amount);

/** text colour that is readable on top of `background` (dark ink or white) */
export function readableOn(background: string, dark = '#0b0c10', light = '#ffffff'): string {
  return contrast(background, dark) >= contrast(background, light) ? dark : light;
}
