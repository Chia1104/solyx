import { Suspense, lazy, useLayoutEffect, useRef, useState } from "react";

import { ClientOnly, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useTranslation } from "react-i18next";

import { langParam, useLocale } from "../../lib/i18n.ts";
import { RELEASES_URL } from "../../lib/links.ts";
import { buttonVariants } from "../ui/button.tsx";

import { PencilHalf } from "./pencil-half.tsx";
import { StillHorizon } from "./still-horizon.tsx";

// The shaders engine carries every effect it offers, so it loads after the page rather than with it.
const Horizon = lazy(() =>
  import("./horizon.tsx").then((module) => ({ default: module.Horizon }))
);

const Canvas = {
  Pending: "pending",
  Ready: "ready",
  Unavailable: "unavailable",
} as const;

type Canvas = (typeof Canvas)[keyof typeof Canvas];

interface Frame {
  width: number;
  height: number;
  sun: number;
}

/**
 * The panel's lower edge is the horizon: the sun is inked above it and pencilled below it, as the
 * app icon draws it. The page sets the sun's size as `--sun`, which the panel leaves room for.
 */
export function Hero() {
  const { t } = useTranslation();
  const locale = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const halfRef = useRef<SVGSVGElement>(null);

  const [frame, setFrame] = useState<Frame>({ width: 0, height: 0, sun: 0 });
  const [canvas, setCanvas] = useState<Canvas>(Canvas.Pending);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const half = halfRef.current;

    if (!panel || !half) return;

    const measure = () =>
      setFrame({
        width: panel.clientWidth,
        height: panel.clientHeight,
        sun: half.getBoundingClientRect().width / 2,
      });

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(half);

    return () => observer.disconnect();
  }, []);

  return (
    <section className="relative p-2">
      <div
        ref={panelRef}
        className="relative isolate overflow-hidden rounded-2xl bg-muted">
        <div
          aria-hidden="true"
          className="stipple absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_95%),radial-gradient(circle_at_50%_100%,transparent_calc(var(--sun)*1.6),black_calc(var(--sun)*2.6))] [mask-composite:intersect]"
        />
        <ClientOnly>
          <div
            aria-hidden="true"
            className="absolute inset-0 transition-opacity duration-500 ease-out data-[canvas=pending]:opacity-0"
            data-canvas={canvas}>
            <Suspense>
              <Horizon
                {...frame}
                onReady={() => setCanvas(Canvas.Ready)}
                onUnavailable={() => setCanvas(Canvas.Unavailable)}
              />
            </Suspense>
          </div>
        </ClientOnly>

        {canvas === Canvas.Unavailable && <StillHorizon {...frame} />}

        {/* The horizon, ruled in pencil and fading out before the panel's rounded corners. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 bg-[linear-gradient(90deg,transparent,var(--graphite)_22%,var(--graphite)_78%,transparent)]"
        />

        <div className="relative mx-auto max-w-5xl px-6 pt-20 pb-[calc(var(--sun)*2.3+2rem)] text-center md:pt-28">
          <h1 className="text-[clamp(2.4rem,6.4vw,4.75rem)] leading-[0.98] font-[540] tracking-[-0.028em] text-balance [font-stretch:112%]">
            <span className="pencil-text block">{t("hero.pencil")}</span>
            {/* The ink copy wipes over the pencilled one; only the pencilled one is read out. */}
            <span className="relative mx-auto block w-fit">
              <span className="pencil-text">{t("hero.ink")}</span>
              <span
                aria-hidden="true"
                className="text-primary animate-ink-in motion-reduce:animate-fade-in absolute inset-0">
                {t("hero.ink")}
              </span>
            </span>
          </h1>
          <p className="mx-auto mt-7 max-w-[34em] text-lg leading-relaxed text-pretty">
            {t("hero.lede")}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={RELEASES_URL}
              className={cn(
                buttonVariants({ variant: "foreground", size: "lg" }),
                "h-12 rounded-full px-6 text-base"
              )}>
              {t("hero.download")}
            </a>
            <Link
              to="/{-$lang}/docs/$"
              params={{ lang: langParam(locale), _splat: "" }}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-12 rounded-full px-6 text-base"
              )}>
              {t("hero.docs")}
            </Link>
          </div>
          <p className="text-muted-foreground mt-4 text-sm">{t("hero.note")}</p>
        </div>
      </div>

      <PencilHalf
        ref={halfRef}
        className="animate-pencil-in motion-reduce:animate-fade-in absolute top-[calc(100%-0.5rem)] left-1/2 z-10 h-auto w-[calc(var(--sun)*2)] -translate-x-1/2"
      />
    </section>
  );
}
