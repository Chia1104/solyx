import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ClientOnly } from "@tanstack/react-router";
import { cn } from "cn";
import { Check } from "lucide-react";

import { prefersReducedMotion, useInView } from "../../lib/motion.ts";

import { SheetRow } from "./sheet.tsx";

// The shaders engine loads after the page, as the hero's does.
const InkRipples = lazy(() =>
  import("./ink-ripples.tsx").then((module) => ({
    default: module.InkRipples,
  }))
);

const DRAFTS = [
  { order: "Sell 2,000 0050 @ 112.00", status: "Dismissed" },
  { order: "Forecast: 2330 above 2,500 by Friday", status: "58%" },
  { order: "Buy 1,000 2454 @ 4,520", status: "Awaiting confirmation" },
  { order: "Research report: 2308 monthly revenue", status: "Draft" },
  { order: "Buy 1,000 2881 @ 159.5", status: "Awaiting confirmation" },
  { order: "Forecast: 6669 holds 2,100 for ten sessions", status: "64%" },
  { order: "Sell 1,000 2308 @ 1,790", status: "Awaiting confirmation" },
];

const SLOTS = [
  "md:top-1 md:left-[6%] md:w-[66%]",
  "md:top-[3.25rem] md:left-[24%] md:w-[70%]",
  "md:top-[6.5rem] md:left-0 md:w-[76%]",
  "md:top-[9.75rem] md:left-[30%] md:w-[66%]",
];

const REDRAFT_MS = 2400;

const CELL = "flex flex-col gap-8 px-6 pt-10 pb-9 md:h-[31rem] md:px-10";

const CELL_TITLE =
  "text-center text-[clamp(1.75rem,3vw,2.125rem)] leading-tight font-[470] tracking-[-0.02em] [font-stretch:108%]";

interface Slip {
  draft: number;
  /** Whether the loop drew it, so it sketches in; the first four are there from the start. */
  drawn: boolean;
}

/** The agent keeps drafting while the sheet is on screen: one slip at a time is drawn anew. */
function useRedrafting(inView: boolean): Slip[] {
  const [slips, setSlips] = useState<Slip[]>(() =>
    SLOTS.map((_, slot) => ({ draft: slot, drawn: false }))
  );

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return;

    const timer = setInterval(
      () =>
        setSlips((current) => {
          const drafts = current.map((slip) => slip.draft);
          const oldest = drafts.indexOf(Math.min(...drafts));
          const newest = Math.max(...drafts);

          return current.map((slip, slot) =>
            slot === oldest ? { draft: newest + 1, drawn: true } : slip
          );
        }),
      REDRAFT_MS
    );

    return () => clearInterval(timer);
  }, [inView]);

  return slips;
}

interface Ripple {
  center: { x: number; y: number };
  height: number;
}

/** The app's two marks side by side: a sheet of pencilled drafts, and one order signed in ink. */
export function Legend() {
  const draftsRef = useRef<HTMLUListElement>(null);
  const inkRef = useRef<HTMLElement>(null);
  const signedRef = useRef<HTMLParagraphElement>(null);

  const slips = useRedrafting(useInView(draftsRef));
  const [ripple, setRipple] = useState<Ripple | null>(null);

  useLayoutEffect(() => {
    const ink = inkRef.current;
    const signed = signedRef.current;

    if (!ink || !signed) return;

    const measure = () => {
      const cell = ink.getBoundingClientRect();
      const chip = signed.getBoundingClientRect();

      setRipple({
        center: {
          x: (chip.left + chip.width / 2 - cell.left) / cell.width,
          y: (chip.top + chip.height / 2 - cell.top) / cell.height,
        },
        height: cell.height,
      });
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(ink);

    return () => observer.disconnect();
  }, []);

  return (
    <SheetRow className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
      <section className={CELL}>
        <h2 className={CELL_TITLE}>Pencil is a draft</h2>
        <ul
          ref={draftsRef}
          aria-label="Drafts"
          className="flex flex-col gap-2 md:relative md:block md:h-56">
          {slips.map(({ draft, drawn }, slot) => {
            const { order, status } = DRAFTS[draft % DRAFTS.length];

            return (
              <li
                key={draft}
                className={cn(
                  "flex items-baseline justify-between gap-4 rounded-md pencil bg-background px-3.5 py-2.5 text-sm md:absolute md:whitespace-nowrap",
                  status === "Awaiting confirmation" && "font-semibold",
                  drawn && "animate-pencil-in",
                  SLOTS[slot]
                )}>
                <span>{order}</span>
                <span className="text-muted-foreground shrink-0 text-xs font-normal">
                  {status}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground mt-auto max-w-[31em] leading-relaxed">
          Hatching and dashed outlines mark what is not real yet: a proposal
          waiting for you, a forecast, the paper account. Nothing drawn in
          pencil has reached a broker.
        </p>
      </section>

      <section
        ref={inkRef}
        className={cn(
          CELL,
          "bg-primary text-primary-foreground relative isolate overflow-hidden"
        )}>
        <ClientOnly>
          <div aria-hidden="true" className="absolute inset-0">
            <Suspense>
              {ripple && <InkRipples {...ripple} pitch={8} />}
            </Suspense>
          </div>
        </ClientOnly>
        <h2 className={cn(CELL_TITLE, "relative")}>Ink is what you signed</h2>
        <div className="relative flex items-center justify-center py-6 md:h-56 md:py-0">
          <span
            aria-hidden="true"
            className="border-primary-foreground/55 absolute inset-x-[-1.5rem] top-1/2 border-t-[1.5px] border-dotted md:inset-x-[-2.5rem]"
          />
          <p
            ref={signedRef}
            className="bg-primary-foreground relative flex items-center gap-3 rounded-full px-5 py-3 text-[0.9375rem] font-medium text-foreground">
            <Check aria-hidden="true" className="text-primary size-4" />
            Buy 1,000 2454 @ 4,520
            <span className="text-primary">Submitted</span>
          </p>
        </div>
        <p className="text-primary-foreground/85 relative mt-auto max-w-[31em] leading-relaxed">
          An order turns to ink once you confirm it. Confirm is the only button
          Solyx fills with ink, and no setting lets the agent press it.
        </p>
      </section>
    </SheetRow>
  );
}
