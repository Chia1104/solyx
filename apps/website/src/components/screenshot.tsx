import { useState } from "react";

import { isEqual } from "es-toolkit";
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

const sourcesOf = (
  file: string,
  lang: string | undefined,
  theme: ScreenshotTheme
) =>
  screenshotCandidates(file, lang, theme)
    .map(sourceOf)
    .filter((src) => src !== undefined);

function PendingFrame() {
  const { t } = useTranslation();

  return (
    <div className="flex aspect-video items-center justify-center rounded-lg pencil">
      <span className="text-graphite bg-background px-2 font-mono text-xs tracking-widest uppercase">
        {t("docs.screenshot-pending")}
      </span>
    </div>
  );
}

/** The first of `sources` that loads, which opens larger when clicked, or the pencilled frame. */
function Shot({ sources, alt }: { sources: string[]; alt: string }) {
  const [failed, setFailed] = useState(0);
  const src = sources[failed];

  if (src === undefined) return <PendingFrame />;

  // Set from the render's count, so the error event and the check below skip the same shot once.
  const skip = () => setFailed(failed + 1);

  return (
    <ImageZoom
      key={src}
      src={src}
      alt={alt}
      onError={skip}
      // A prerendered shot can fail before the page hydrates, when no listener hears its error.
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) skip();
      }}
      className="rounded-lg border border-border"
    />
  );
}

/**
 * A screenshot, which opens larger when clicked. `file` names it under `content/docs/images`, or
 * under `docs/` on the asset host; a copy tagged with the page's language or a colour scheme, as
 * `name.zh-TW.dark.png`, is shown where it fits, and one that fails to load gives way to the next
 * that fits. Until any copy loads, a pencilled frame holds its place.
 */
export function Screenshot({ file, alt }: { file: string; alt: string }) {
  const lang = langParam(useLocale());
  const light = sourcesOf(file, lang, ScreenshotTheme.Light);
  const dark = sourcesOf(file, lang, ScreenshotTheme.Dark);

  return (
    <figure className="not-prose my-6">
      {/* Both schemes' shots are drawn and the stylesheet shows one, since a prerendered page
          cannot know the reader's scheme. */}
      {isEqual(light, dark) ? (
        <Shot sources={light} alt={alt} />
      ) : (
        <>
          <div className="dark:hidden">
            <Shot sources={light} alt={alt} />
          </div>
          <div className="hidden dark:block">
            <Shot sources={dark} alt={alt} />
          </div>
        </>
      )}
      <figcaption className="text-muted-foreground mt-2 text-center text-sm">
        {alt}
      </figcaption>
    </figure>
  );
}
