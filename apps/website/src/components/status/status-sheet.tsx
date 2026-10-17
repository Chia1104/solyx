import type { ReactNode } from "react";

import { HomeLayout } from "fumadocs-ui/layouts/home";

import { useLocale } from "../../lib/i18n.ts";
import { baseOptions } from "../../lib/layout.tsx";
import { Sheet, SheetRow } from "../landing/sheet.tsx";
import { SiteFooter } from "../landing/site-footer.tsx";

import { IsometricMark } from "./isometric-mark.tsx";
import type { Glyph } from "./isometric-mark.tsx";

/** The site's pill, for the way out a status page offers. */
export const PILL = "h-12 rounded-full px-6 text-base";

export interface StatusSheetProps {
  glyphs: readonly Glyph[];
  title: string;
  lede: string;
  /** The ways out, as pills. */
  children: ReactNode;
}

/** A page that stands in for a missing or failed one: its status drafted in pencil, then the ways out. */
export function StatusSheet({
  glyphs,
  title,
  lede,
  children,
}: StatusSheetProps) {
  return (
    <HomeLayout {...baseOptions(useLocale())}>
      <main className="flex-1">
        <Sheet>
          <SheetRow
            ruled={false}
            className="animate-pencil-in motion-reduce:animate-fade-in overflow-hidden px-6 pt-16 pb-12 md:pt-20">
            <IsometricMark
              glyphs={glyphs}
              className="mx-auto block h-auto max-h-72 w-full max-w-3xl"
            />
          </SheetRow>
          <SheetRow className="px-6 py-12 text-center md:py-14">
            <h1 className="text-[clamp(2rem,4.4vw,3rem)] leading-[1.04] font-[470] tracking-[-0.025em] text-balance [font-stretch:108%]">
              {title}
            </h1>
            <p className="text-muted-foreground mx-auto mt-4 max-w-[34em] text-lg leading-relaxed text-pretty">
              {lede}
            </p>
          </SheetRow>
          <SheetRow className="flex flex-wrap items-center justify-center gap-3 px-6 py-8">
            {children}
          </SheetRow>
        </Sheet>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
