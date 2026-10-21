import { ASSETS_URL } from "./links.ts";

/** The colour scheme a screenshot was taken in. */
export const ScreenshotTheme = {
  Light: "light",
  Dark: "dark",
} as const;

export type ScreenshotTheme =
  (typeof ScreenshotTheme)[keyof typeof ScreenshotTheme];

/** Screenshots on the asset host sit under `docs/` as they would under `content/docs/images`. */
export const SCREENSHOT_ASSETS_URL = `${ASSETS_URL}/docs`;

const OTHER_THEME = {
  [ScreenshotTheme.Light]: ScreenshotTheme.Dark,
  [ScreenshotTheme.Dark]: ScreenshotTheme.Light,
};

/** `name.png` with `tags` before its extension: `name.zh-TW.dark.png`. */
const tagged = (file: string, ...tags: string[]) => {
  const dot = file.lastIndexOf(".");

  return [file.slice(0, dot), ...tags].join(".") + file.slice(dot);
};

/**
 * The files that could show `file` on a page in `lang`, none for English, and in `theme`, most
 * fitting first. A shot in the page's language comes before one in English, since its text is
 * what a reader compares with their app; within a language, one in the page's scheme, then one
 * taken for either, then one in the other scheme.
 */
export function screenshotCandidates(
  file: string,
  lang: string | undefined,
  theme: ScreenshotTheme
): string[] {
  const inLanguage = (tags: string[]) => [
    tagged(file, ...tags, theme),
    tagged(file, ...tags),
    tagged(file, ...tags, OTHER_THEME[theme]),
  ];

  return lang ? [...inLanguage([lang]), ...inLanguage([])] : inLanguage([]);
}
