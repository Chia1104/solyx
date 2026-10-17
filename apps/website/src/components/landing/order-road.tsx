import { useEffect, useRef, useState } from "react";

import { cn } from "cn";

import { prefersReducedMotion, useInView } from "../../lib/motion.ts";

import { SheetHead, SheetRow } from "./sheet.tsx";

const STEPS = [
  {
    title: "The agent proposes",
    detail: "Its tools can draft a proposal and nothing more.",
  },
  {
    title: "Risk checks run",
    detail: "Lot size, tick, the day's limits, cash and the session.",
  },
  {
    title: "You confirm",
    detail: "Only your click in the app gets past this step.",
  },
  {
    title: "The checks run again",
    detail: "The market may have moved since the draft.",
  },
  {
    title: "The broker gets the order",
    detail: "A paper account until you switch a live broker on.",
  },
];

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
        <SheetHead id="order-road" title="One road to an order">
          Every order takes these five steps. No setting, mode or extension adds
          another way to the broker.
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
                key={step.title}
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
                <h3 className="relative font-semibold">{step.title}</h3>
                <p className="text-muted-foreground relative mt-1.5 text-[0.9375rem] leading-relaxed">
                  {step.detail}
                </p>
              </li>
            );
          })}
        </ol>
      </SheetRow>

      <SheetRow>
        <p className="max-w-[46em] px-6 py-7 leading-relaxed md:px-10">
          A failed submission is never retried, since the broker may have taken
          the order anyway. Solyx marks it failed and leaves the next move to
          you.
        </p>
      </SheetRow>
    </>
  );
}
