import { useEffect, useRef, useState } from "react";

import { cn } from "cn";
import { useTranslation } from "react-i18next";

import type websiteEnUS from "@solyx/i18n/website/en-US.json";

import { prefersReducedMotion, useInView } from "../../lib/motion.ts";

import { SheetHead, SheetRow } from "./sheet.tsx";

// In the order an order takes them; the catalog holds each step's words.
const STEPS = [
  "propose",
  "check",
  "confirm",
  "recheck",
  "broker",
] satisfies (keyof (typeof websiteEnUS)["road"]["steps"])[];

// The road is pencil up to the confirmation and ink from it on.
const CONFIRM = 2;

const TICK_MS = 700;

/**
 * One pass of the loop in ticks: the road clears over two, fills a step a tick, then holds. It
 * starts on the hold, so the road is first seen whole, as the page draws it without script.
 */
const CLEAR_TICKS = 2;

const HOLD_TICKS = 4;

const TICKS = CLEAR_TICKS + STEPS.length + HOLD_TICKS;

const FIRST_TICK = CLEAR_TICKS + STEPS.length;

/** How far the road is filled at a tick, and whether it is fading out to start again. */
function roadAt(tick: number) {
  if (tick === 0) return { filled: STEPS.length, clearing: true };

  if (tick < CLEAR_TICKS) return { filled: 0, clearing: true };

  return {
    filled: Math.min(tick - CLEAR_TICKS + 1, STEPS.length),
    clearing: false,
  };
}

export function OrderRoad() {
  const { t } = useTranslation();
  const roadRef = useRef<HTMLOListElement>(null);
  const inView = useInView(roadRef);
  const [tick, setTick] = useState(FIRST_TICK);

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return;

    const timer = setInterval(
      () => setTick((current) => (current + 1) % TICKS),
      TICK_MS
    );

    return () => clearInterval(timer);
  }, [inView]);

  const { filled, clearing } = roadAt(tick);

  return (
    <>
      <SheetRow>
        <SheetHead id="order-road" title={t("road.title")}>
          {t("road.lede")}
        </SheetHead>
      </SheetRow>

      <SheetRow>
        <ol
          ref={roadRef}
          aria-labelledby="order-road"
          className="grid gap-px bg-border md:grid-cols-5">
          {STEPS.map((step, index) => {
            const inked = index >= CONFIRM;

            return (
              <li
                key={step}
                data-filled={index < filled}
                className="group relative bg-background px-6 pt-8 pb-9 md:px-5">
                {/* Each step fills from the left in turn: pencil until the confirmation, ink after it. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-0 border-t-2 [clip-path:inset(0_100%_0_0)] [transition:clip-path_600ms_var(--ease-in-out),opacity_400ms_var(--ease-out)] group-data-[filled=true]:[clip-path:inset(0)] motion-reduce:transition-none",
                    inked
                      ? "border-primary bg-primary/10"
                      : "border-graphite border-dashed hatch [--hatch-color:color-mix(in_oklab,var(--graphite)_22%,transparent)]",
                    clearing && "opacity-0"
                  )}
                />
                <h3 className="relative font-semibold">
                  {t(`road.steps.${step}.title`)}
                </h3>
                <p className="text-muted-foreground relative mt-1.5 text-[0.9375rem] leading-relaxed">
                  {t(`road.steps.${step}.detail`)}
                </p>
              </li>
            );
          })}
        </ol>
      </SheetRow>

      <SheetRow>
        <p className="max-w-[46em] px-6 py-7 leading-relaxed md:px-10">
          {t("road.failed")}
        </p>
      </SheetRow>
    </>
  );
}
