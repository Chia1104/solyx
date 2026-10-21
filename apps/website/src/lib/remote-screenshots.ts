import { access, glob, readFile } from "node:fs/promises";
import { join } from "node:path";

import { limitAsync, uniq } from "es-toolkit";

import {
  SCREENSHOT_ASSETS_URL,
  ScreenshotTheme,
  screenshotCandidates,
} from "./screenshots.ts";

// A screenshot's props may run over several lines once formatted.
const SCREENSHOT_FILE = /<Screenshot\b[^>]*?\bfile="([^"]+)"/g;

const PAGE_LANG = /\.([a-z]{2}-[A-Z]{2})\.mdx$/;

/** Whether the asset host holds `path`; an answer other than found or not found fails the build. */
const held = limitAsync(async (path: string) => {
  const url = `${SCREENSHOT_ASSETS_URL}/${path}`;

  const response = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 404) return false;

  if (!response.ok) {
    throw new Error(`The asset host answered ${url} with ${response.status}`);
  }

  return true;
}, 8);

/**
 * The screenshots the asset host holds of those the docs could show, by their path under `docs/`:
 * each file a page names, in the page's language and either scheme, less those the repository
 * keeps, since the repository's copy is the one shown.
 */
export async function readRemoteScreenshots(docsDir: string) {
  const candidates: string[] = [];

  for await (const page of glob("**/*.mdx", { cwd: docsDir })) {
    const lang = PAGE_LANG.exec(page)?.[1];
    const source = await readFile(join(docsDir, page), "utf8");

    for (const [, file] of source.matchAll(SCREENSHOT_FILE)) {
      for (const theme of Object.values(ScreenshotTheme)) {
        candidates.push(...screenshotCandidates(file, lang, theme));
      }
    }
  }

  const found = await Promise.all(
    uniq(candidates).map(async (path) => {
      const inRepository = await access(join(docsDir, "images", path)).then(
        () => true,
        () => false
      );

      return !inRepository && (await held(path)) ? path : undefined;
    })
  );

  return found.filter((path) => path !== undefined).toSorted();
}
