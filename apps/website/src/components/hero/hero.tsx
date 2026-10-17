import { Suspense, lazy, useLayoutEffect, useRef, useState } from "react";

import { ClientOnly, Link } from "@tanstack/react-router";
import { cn } from "cn";

import { RELEASES_URL } from "../../lib/links.ts";
import { buttonVariants } from "../ui/button.tsx";

import type { Sun } from "./horizon.tsx";
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
  horizon: number;
}

/** Where the sun sits; the sky's padding below the headline leaves room for it on phones. */
function sunFor({ width }: Frame): Sun {
  return width < 768
    ? { x: width * 0.8, radius: width * 0.2 }
    : { x: width * 0.79, radius: width * 0.17 };
}

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const skyRef = useRef<HTMLDivElement>(null);

  const [frame, setFrame] = useState<Frame>({
    width: 0,
    height: 0,
    horizon: 0,
  });

  const [canvas, setCanvas] = useState<Canvas>(Canvas.Pending);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const sky = skyRef.current;

    if (!section || !sky) return;

    const measure = () =>
      setFrame({
        width: section.clientWidth,
        height: section.clientHeight,
        // The middle of the sky's 2px bottom border.
        horizon: sky.offsetTop + sky.offsetHeight - 1,
      });

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(section);
    observer.observe(sky);

    return () => observer.disconnect();
  }, []);

  const sun = sunFor(frame);

  return (
    <section
      ref={sectionRef}
      className="drafting-grid relative isolate overflow-hidden border-b border-border">
      <ClientOnly>
        <div
          aria-hidden="true"
          className="absolute inset-0 transition-opacity duration-500 ease-out data-[canvas=pending]:opacity-0"
          data-canvas={canvas}>
          <Suspense>
            <Horizon
              {...frame}
              sun={sun}
              onReady={() => setCanvas(Canvas.Ready)}
              onUnavailable={() => setCanvas(Canvas.Unavailable)}
            />
          </Suspense>
        </div>
      </ClientOnly>

      {canvas === Canvas.Unavailable && <StillHorizon {...frame} sun={sun} />}

      {/* The horizon is the sky's lower edge, so it stands before the canvas measures anything. */}
      <div ref={skyRef} className="relative border-b-2 border-foreground">
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-[calc(20vw+1.5rem)] md:pt-28 md:pb-12">
          <h1 className="max-w-[11.5em] text-[clamp(2.4rem,6.2vw,4.6rem)] leading-[0.98] font-[640] tracking-[-0.02em] [font-stretch:118%]">
            <span className="pencil-text block text-balance">
              The agent drafts in pencil.
            </span>
            <span className="text-primary block text-balance">
              You sign in ink.
            </span>
          </h1>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="max-w-xl pt-[calc(20vw+1rem)] pb-20 md:pt-10 md:pb-28">
          <p className="text-lg leading-relaxed text-foreground">
            Solyx is a desktop app for trading Taiwan and US stocks. An agent
            reads the market and proposes orders, and nothing reaches your
            broker until you confirm it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={RELEASES_URL}
              className={cn(
                buttonVariants({ variant: "foreground", size: "lg" }),
                "h-11 px-5 text-base"
              )}>
              Download for macOS or Windows
            </a>
            <Link
              to="/docs/$"
              params={{ _splat: "" }}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 px-5 text-base"
              )}>
              Read the docs
            </Link>
          </div>
          <p className="text-muted-foreground mt-5 text-sm">
            Free and open source. Nightly builds trade on a paper account.
          </p>
        </div>
      </div>
    </section>
  );
}
