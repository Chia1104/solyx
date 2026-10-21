import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { useTranslation } from "react-i18next";

const DIR = "../../content/docs/images/";

// Found by name at build time, so a page can name a screenshot before its file is taken.
const images = import.meta.glob<string>(
  "../../content/docs/images/**/*.{png,jpg,webp}",
  { eager: true, import: "default" }
);

/**
 * A screenshot from `content/docs/images`, which opens larger when clicked. Until its file exists,
 * a pencilled frame holds its place.
 */
export function Screenshot({ file, alt }: { file: string; alt: string }) {
  const { t } = useTranslation();
  const src = images[`${DIR}${file}`];

  return (
    <figure className="not-prose my-6">
      {src ? (
        <ImageZoom
          src={src}
          alt={alt}
          className="rounded-lg border border-border"
        />
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
