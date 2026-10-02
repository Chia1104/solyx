/** The appearance a window shows, once `system` resolves to the computer's. */
export const ColorScheme = {
  Light: "light",
  Dark: "dark",
} as const;

export type ColorScheme = (typeof ColorScheme)[keyof typeof ColorScheme];

/**
 * The workspace's colours in one scheme, as sRGB hex because the chart canvas and Electron's
 * window chrome accept nothing else. The renderer turns each key into a CSS custom property
 * (`surfaceSecondary` → `--surface-secondary`), which HeroUI and the stylesheet read.
 */
export interface PaletteColors {
  background: string;
  foreground: string;
  surface: string;
  surfaceSecondary: string;
  surfaceTertiary: string;
  overlay: string;
  fieldBackground: string;
  segment: string;
  default: string;
  muted: string;
  separator: string;
  border: string;
  accent: string;
  accentForeground: string;
  /** Quote text, readable on the surface. */
  quoteRed: string;
  quoteGreen: string;
  /** Candles and bars on the chart, brighter than the text pair. */
  candleRed: string;
  candleGreen: string;
}

/**
 * Drawn like a drafting sheet: agents draft in pencil, the user signs in ink. Neutrals carry a
 * trace of slate blue, vellum by day and blueprint by night; red and green belong to prices alone.
 */
export const PALETTE: Record<ColorScheme, PaletteColors> = {
  [ColorScheme.Light]: {
    background: "#f3f5f8",
    foreground: "#23272f",
    surface: "#fcfdfe",
    surfaceSecondary: "#edeff4",
    surfaceTertiary: "#e7eaf0",
    overlay: "#fcfdfe",
    fieldBackground: "#fcfdfe",
    segment: "#fcfdfe",
    default: "#e7eaf0",
    muted: "#646c7b",
    separator: "#dce0e7",
    border: "#d2d7df",
    accent: "#2b45d4",
    accentForeground: "#fcfdfe",
    quoteRed: "#c72c37",
    quoteGreen: "#0b7643",
    candleRed: "#e5484d",
    candleGreen: "#30a46c",
  },
  [ColorScheme.Dark]: {
    background: "#0f141c",
    foreground: "#e4e8ef",
    surface: "#161c27",
    surfaceSecondary: "#1b222e",
    surfaceTertiary: "#212937",
    overlay: "#161c27",
    fieldBackground: "#1b222e",
    segment: "#2b3545",
    default: "#212937",
    muted: "#8a94a6",
    separator: "#232c3a",
    border: "#2b3545",
    accent: "#8097ff",
    accentForeground: "#0f141c",
    quoteRed: "#ef6567",
    quoteGreen: "#43c07a",
    candleRed: "#e5484d",
    candleGreen: "#30a46c",
  },
};
