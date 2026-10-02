import * as z from "zod";

/** The appearance a window shows, once `system` resolves to the computer's. */
export const ColorScheme = {
  Light: "light",
  Dark: "dark",
} as const;

export type ColorScheme = (typeof ColorScheme)[keyof typeof ColorScheme];

export const colorSchemeSchema = z.enum(ColorScheme);

/** The palettes the app ships; the user picks one for each scheme. */
export const Palette = {
  /** Drawn like a drafting sheet: slate-blue vellum by day and blueprint by night, inked in indigo. */
  Blueprint: "blueprint",
  Graphite: "graphite",
  Sepia: "sepia",
  Iris: "iris",
  Lagoon: "lagoon",
} as const;

export type Palette = (typeof Palette)[keyof typeof Palette];

export const paletteSchema = z.enum(Palette);

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
  /** Never red or green, which belong to price direction. */
  accent: string;
  accentForeground: string;
  /** Quote text, readable on the surface. */
  quoteRed: string;
  quoteGreen: string;
  /** Candles and bars on the chart, brighter than the text pair. */
  candleRed: string;
  candleGreen: string;
}

// Every palette quotes prices in the same pair, so a rise reads the same whichever is picked.
const PRICE_COLORS: Record<
  ColorScheme,
  Pick<PaletteColors, "quoteRed" | "quoteGreen" | "candleRed" | "candleGreen">
> = {
  [ColorScheme.Light]: {
    quoteRed: "#c72c37",
    quoteGreen: "#0b7643",
    candleRed: "#e5484d",
    candleGreen: "#30a46c",
  },
  [ColorScheme.Dark]: {
    quoteRed: "#ef6567",
    quoteGreen: "#43c07a",
    candleRed: "#e5484d",
    candleGreen: "#30a46c",
  },
};

export const PALETTES: Record<Palette, Record<ColorScheme, PaletteColors>> = {
  [Palette.Blueprint]: {
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
      ...PRICE_COLORS[ColorScheme.Light],
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
      ...PRICE_COLORS[ColorScheme.Dark],
    },
  },
  [Palette.Graphite]: {
    [ColorScheme.Light]: {
      background: "#f5f5f5",
      foreground: "#262728",
      surface: "#fdfdfd",
      surfaceSecondary: "#efeff0",
      surfaceTertiary: "#e9eaeb",
      overlay: "#fdfdfd",
      fieldBackground: "#fdfdfd",
      segment: "#fdfdfd",
      default: "#e9eaeb",
      muted: "#6a6c6e",
      separator: "#dfe0e1",
      border: "#d6d7d8",
      accent: "#8f520d",
      accentForeground: "#fdfdfd",
      ...PRICE_COLORS[ColorScheme.Light],
    },
    [ColorScheme.Dark]: {
      background: "#131415",
      foreground: "#e7e8e9",
      surface: "#1b1c1e",
      surfaceSecondary: "#202224",
      surfaceTertiary: "#27292c",
      overlay: "#1b1c1e",
      fieldBackground: "#202224",
      segment: "#333538",
      default: "#27292c",
      muted: "#919497",
      separator: "#2a2c2e",
      border: "#333538",
      accent: "#f6b84d",
      accentForeground: "#131415",
      ...PRICE_COLORS[ColorScheme.Dark],
    },
  },
  [Palette.Sepia]: {
    [ColorScheme.Light]: {
      background: "#f8f4ef",
      foreground: "#2f2515",
      surface: "#fefdfb",
      surfaceSecondary: "#f4efe7",
      surfaceTertiary: "#f0e9de",
      overlay: "#fefdfb",
      fieldBackground: "#fefdfb",
      segment: "#fefdfb",
      default: "#f0e9de",
      muted: "#7b694c",
      separator: "#e7dfd1",
      border: "#dfd5c6",
      accent: "#125492",
      accentForeground: "#fefdfb",
      ...PRICE_COLORS[ColorScheme.Light],
    },
    [ColorScheme.Dark]: {
      background: "#19120c",
      foreground: "#ede7e2",
      surface: "#231a12",
      surfaceSecondary: "#2a1f16",
      surfaceTertiary: "#32261c",
      overlay: "#231a12",
      fieldBackground: "#2a1f16",
      segment: "#3f3126",
      default: "#32261c",
      muted: "#a09084",
      separator: "#35291e",
      border: "#3f3126",
      accent: "#7db7ee",
      accentForeground: "#19120c",
      ...PRICE_COLORS[ColorScheme.Dark],
    },
  },
  [Palette.Iris]: {
    [ColorScheme.Light]: {
      background: "#f5f4f8",
      foreground: "#282530",
      surface: "#fdfdfe",
      surfaceSecondary: "#f0eef4",
      surfaceTertiary: "#ebe8f1",
      overlay: "#fdfdfe",
      fieldBackground: "#fdfdfe",
      segment: "#fdfdfe",
      default: "#ebe8f1",
      muted: "#6e687d",
      separator: "#e1dee8",
      border: "#d8d5e0",
      accent: "#7536be",
      accentForeground: "#fdfdfe",
      ...PRICE_COLORS[ColorScheme.Light],
    },
    [ColorScheme.Dark]: {
      background: "#15121c",
      foreground: "#e9e6ef",
      surface: "#1d1927",
      surfaceSecondary: "#231f2e",
      surfaceTertiary: "#2b2537",
      overlay: "#1d1927",
      fieldBackground: "#231f2e",
      segment: "#373145",
      default: "#2b2537",
      muted: "#9690a6",
      separator: "#2d283a",
      border: "#373145",
      accent: "#ba8ff6",
      accentForeground: "#15121c",
      ...PRICE_COLORS[ColorScheme.Dark],
    },
  },
  [Palette.Lagoon]: {
    [ColorScheme.Light]: {
      background: "#f1f6f8",
      foreground: "#1b2930",
      surface: "#fbfdfe",
      surfaceSecondary: "#eaf1f4",
      surfaceTertiary: "#e2ecf0",
      overlay: "#fbfdfe",
      fieldBackground: "#fbfdfe",
      segment: "#fbfdfe",
      default: "#e2ecf0",
      muted: "#56707c",
      separator: "#d6e2e8",
      border: "#ccd9e0",
      accent: "#00698f",
      accentForeground: "#fbfdfe",
      ...PRICE_COLORS[ColorScheme.Light],
    },
    [ColorScheme.Dark]: {
      background: "#09161b",
      foreground: "#e0eaee",
      surface: "#0d1e26",
      surfaceSecondary: "#11242d",
      surfaceTertiary: "#162c36",
      overlay: "#0d1e26",
      fieldBackground: "#11242d",
      segment: "#1f3843",
      default: "#162c36",
      muted: "#7f98a4",
      separator: "#192f39",
      border: "#1f3843",
      accent: "#53c5e3",
      accentForeground: "#09161b",
      ...PRICE_COLORS[ColorScheme.Dark],
    },
  },
};
