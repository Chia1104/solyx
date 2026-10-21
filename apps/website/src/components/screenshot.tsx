import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { useTranslation } from "react-i18next";
import remoteScreenshots from "virtual:remote-screenshots";

import { langParam, useLocale } from "../lib/i18n.ts";
import {
  SCREENSHOT_ASSETS_URL,
  ScreenshotTheme,
  screenshotCandidates,
} from "../lib/screenshots.ts";

const DIR = "../../content/docs/images/";

// Found by name at build time, so a page can name a screenshot before its file is taken.
const images = import.meta.glob<string>(
  "../../content/docs/images/**/*.{png,jpg,webp}",
  { eager: true, import: "default" }
);

const remote = new Set(remoteScreenshots);

/** Where `path` is served: the repository's copy, else the asset host's, if either holds it. */
const sourceOf = (path: string) =>
  images[`${DIR}${path}`] ??
  (remote.has(path) ? `${SCREENSHOT_ASSETS_URL}/${path}` : undefined);

const resolve = (
  file: string,
  lang: string | undefined,
  theme: ScreenshotTheme
) => screenshotCandidates(file, lang, theme).map(sourceOf).find(Boolean);

/**
 * A screenshot, which opens larger when clicked. `file` names it under `content/docs/images`, or
 * under `docs/` on the asset host; a copy tagged with the page's language or a colour scheme, as
 * `name.zh-TW.dark.png`, is shown where it fits. Until any copy exists, a pencilled frame holds its
 * place.
 */
export function Screenshot({ file, alt }: { file: string; alt: string }) {
  const { t } = useTranslation();
  const lang = langParam(useLocale());
  const light = resolve(file, lang, ScreenshotTheme.Light);
  const dark = resolve(file, lang, ScreenshotTheme.Dark);

  const shot = (src: string) => (
    <ImageZoom
      src={src}
      alt={alt}
      className="rounded-lg border border-border"
    />
  );

  return (
    <figure className="not-prose my-6">
      {/* Both schemes' shots are drawn and the stylesheet shows one, since a prerendered page
          cannot know the reader's scheme. */}
      {light && dark && light !== dark ? (
        <>
          <div className="dark:hidden">{shot(light)}</div>
          <div className="hidden dark:block">{shot(dark)}</div>
        </>
      ) : light ? (
        shot(light)
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg pencil">
          <span className="text-graphite bg-background px-2 font-mono text-xs tracking-widest uppercase">
            {t("docs.screenshot-pending")}
          </span>
        </div>
      )}
      <figcaption className="text-muted-foreground mt-2 text-center text-sm">
        {alt}
      </figcaption>
    </figure>
  );
}
