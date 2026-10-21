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

/** Whether the asset host holds `path`, or `undefined` when it answers neither found nor not found. */
const held = limitAsync(async (path: string) => {
  const response = await fetch(`${SCREENSHOT_ASSETS_URL}/${path}`, {
    method: "HEAD",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);

  if (response?.ok) return true;

  return response?.status === 404 ? false : undefined;
}, 8);

/**
 * The screenshots the docs could show from the asset host, by their path under `docs/`: each file a
 * page names, in the page's language and either scheme, less those the repository keeps, since the
 * repository's copy is the one shown. `offered` holds those the host holds and those it gave no
 * answer for, which are also listed in `unanswered`: a page offers them, and the browser falls
 * back past one that fails to load, so the host's trouble never fails the build.
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

  const answers = await Promise.all(
    uniq(candidates).map(async (path) => {
      const inRepository = await access(join(docsDir, "images", path)).then(
        () => true,
        () => false
      );

      return { path, held: inRepository ? false : await held(path) };
    })
  );

  return {
    offered: answers
      .filter((answer) => answer.held !== false)
      .map((answer) => answer.path)
      .toSorted(),
    unanswered: answers
      .filter((answer) => answer.held === undefined)
      .map((answer) => answer.path)
      .toSorted(),
  };
}
