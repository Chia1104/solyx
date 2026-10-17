import { Suspense, lazy, useLayoutEffect, useRef, useState } from "react";

import { ClientOnly } from "@tanstack/react-router";
import { cn } from "cn";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import type websiteEnUS from "@solyx/i18n/website/en-US.json";
import { isEnumValue } from "@solyx/utils/is";

import { useInView } from "../../lib/motion.ts";

import { SheetRow } from "./sheet.tsx";

// The shaders engine loads after the page, as the hero's does.
const InkRipples = lazy(() =>
  import("./ink-ripples.tsx").then((module) => ({
    default: module.InkRipples,
  }))
);

type DraftKey = keyof (typeof websiteEnUS)["legend"]["drafts"];

const DraftStatus = {
  Awaiting: "awaiting",
  Dismissed: "dismissed",
  Draft: "draft",
} as const;

type DraftStatus = (typeof DraftStatus)[keyof typeof DraftStatus];

interface Draft {
  key: DraftKey;
  /** Where it stands, as the app names it, or a forecast's chance. */
  status: DraftStatus | `${number}%`;
}

/** Rows of drafts drifting right, each at its own pace, into the inked cell beside them. */
const ROWS: { drafts: Draft[]; seconds: number; delay: number }[] = [
  {
    drafts: [
      { key: "sell-0050", status: DraftStatus.Dismissed },
      { key: "research-0050", status: DraftStatus.Draft },
      { key: "buy-2881", status: DraftStatus.Awaiting },
    ],
    seconds: 32,
    delay: -9,
  },
  {
    drafts: [
      { key: "forecast-2330", status: "58%" },
      { key: "sell-2308", status: DraftStatus.Awaiting },
      { key: "forecast-2454", status: "31%" },
    ],
    seconds: 24,
    delay: -15,
  },
  {
    drafts: [
      { key: "buy-2454", status: DraftStatus.Awaiting },
      { key: "buy-0050", status: DraftStatus.Dismissed },
    ],
    seconds: 28,
    delay: -4,
  },
  {
    drafts: [
      { key: "research-2308", status: DraftStatus.Draft },
      { key: "forecast-6669", status: "64%" },
    ],
    seconds: 36,
    delay: -20,
  },
];

const CELL = "flex flex-col gap-8 px-6 pt-10 pb-9 md:h-[31rem] md:px-10";

const CELL_TITLE =
  "text-center text-[clamp(1.75rem,3vw,2.125rem)] leading-tight font-[470] tracking-[-0.02em] [font-stretch:108%]";

function DraftSlip({ draft }: { draft: Draft }) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "flex shrink-0 items-baseline gap-5 rounded-md pencil bg-background px-3.5 py-2.5 text-sm whitespace-nowrap",
        draft.status === DraftStatus.Awaiting && "font-semibold"
      )}>
      {t(`legend.drafts.${draft.key}`)}
      <span className="text-muted-foreground text-xs font-normal">
        {isEnumValue(DraftStatus, draft.status)
          ? t(`legend.status.${draft.status}`)
          : draft.status}
      </span>
    </span>
  );
}

interface Ripple {
  center: { x: number; y: number };
  height: number;
}

/** The app's two marks side by side: a sheet of pencilled drafts, and one order signed in ink. */
export function Legend() {
  const { t } = useTranslation();
  const draftsRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLElement>(null);
  const signedRef = useRef<HTMLParagraphElement>(null);

  const inView = useInView(draftsRef);
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
    <SheetRow className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
      <section className={CELL}>
        <h2 className={CELL_TITLE}>{t("legend.pencil-title")}</h2>
        {/* Each row is two copies of its drafts, so sliding by one copy loops without a seam. */}
        <div
          ref={draftsRef}
          data-paused={!inView}
          className="group -mx-6 flex flex-col justify-center gap-3.5 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_14%)] md:-mx-10 md:h-56">
          {ROWS.map(({ drafts, seconds, delay }) => (
            <div
              key={drafts[0]?.key}
              style={{
                animationDuration: `${seconds}s`,
                animationDelay: `${delay}s`,
              }}
              className="animate-drift flex w-max group-data-[paused=true]:[animation-play-state:paused] motion-reduce:animate-none">
              {[false, true].map((copy) => (
                <ul
                  key={String(copy)}
                  aria-hidden={copy || undefined}
                  aria-label={copy ? undefined : t("legend.drafts-label")}
                  className="flex gap-10 pr-10">
                  {drafts.map((draft) => (
                    <li key={draft.key}>
                      <DraftSlip draft={draft} />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          ))}
        </div>
        <p className="text-muted-foreground mt-auto max-w-[31em] leading-relaxed">
          {t("legend.pencil-body")}
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
        <h2 className={cn(CELL_TITLE, "relative")}>{t("legend.ink-title")}</h2>
        <div className="relative flex items-center justify-center py-6 md:h-56 md:py-0">
          <span
            aria-hidden="true"
            className="border-primary-foreground/55 absolute inset-x-[-1.5rem] top-1/2 border-t-[1.5px] border-dotted md:inset-x-[-2.5rem]"
          />
          <p
            ref={signedRef}
            className="bg-primary-foreground relative flex items-center gap-3 rounded-full px-5 py-3 text-[0.9375rem] font-medium text-foreground">
            <Check aria-hidden="true" className="text-primary size-4" />
            {t("legend.signed")}
            <span className="text-primary">{t("legend.submitted")}</span>
          </p>
        </div>
        <p className="text-primary-foreground/85 relative mt-auto max-w-[31em] leading-relaxed">
          {t("legend.ink-body")}
        </p>
      </section>
    </SheetRow>
  );
}
