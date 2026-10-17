import { Check } from "lucide-react";

import { SheetRow } from "./sheet.tsx";

const DRAFTS = [
  {
    order: "Sell 2,000 0050 @ 112.00",
    status: "Dismissed",
    place: "md:top-1 md:left-[6%] md:w-[66%]",
  },
  {
    order: "Forecast: 2330 above 2,500 by Friday",
    status: "58%",
    place: "md:top-[3.25rem] md:left-[24%] md:w-[70%]",
  },
  {
    order: "Buy 1,000 2454 @ 4,520",
    status: "Awaiting confirmation",
    place: "md:top-[6.5rem] md:left-0 md:w-[76%] font-semibold",
  },
  {
    order: "Research report: 2308 monthly revenue",
    status: "Draft",
    place: "md:top-[9.75rem] md:left-[30%] md:w-[66%]",
  },
];

const CELL = "flex flex-col gap-8 px-6 pt-10 pb-9 md:h-[31rem] md:px-10";

const CELL_TITLE =
  "text-center text-[clamp(1.75rem,3vw,2.125rem)] leading-tight font-[470] tracking-[-0.02em] [font-stretch:108%]";

/** The app's two marks side by side: a sheet of pencilled drafts, and one order signed in ink. */
export function Legend() {
  return (
    <SheetRow className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
      <section className={CELL}>
        <h2 className={CELL_TITLE}>Pencil is a draft</h2>
        <ul
          aria-label="Drafts"
          className="flex flex-col gap-2 md:relative md:block md:h-56">
          {DRAFTS.map(({ order, status, place }) => (
            <li
              key={order}
              className={`flex items-baseline justify-between gap-4 rounded-md pencil bg-background px-3.5 py-2.5 text-sm md:absolute md:whitespace-nowrap ${place}`}>
              <span>{order}</span>
              <span className="text-muted-foreground shrink-0 text-xs font-normal">
                {status}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-auto max-w-[31em] leading-relaxed">
          Hatching and dashed outlines mark what is not real yet: a proposal
          waiting for you, a forecast, the paper account. Nothing drawn in
          pencil has reached a broker.
        </p>
      </section>

      <section className={`${CELL} bg-primary text-primary-foreground`}>
        <h2 className={CELL_TITLE}>Ink is what you signed</h2>
        <div className="relative flex items-center justify-center py-6 md:h-56 md:py-0">
          <span
            aria-hidden="true"
            className="border-primary-foreground/55 absolute inset-x-[-1.5rem] top-1/2 border-t-[1.5px] border-dotted md:inset-x-[-2.5rem]"
          />
          <p className="bg-primary-foreground relative flex items-center gap-3 rounded-full px-5 py-3 text-[0.9375rem] font-medium text-foreground">
            <Check aria-hidden="true" className="text-primary size-4" />
            Buy 1,000 2454 @ 4,520
            <span className="text-primary">Submitted</span>
          </p>
        </div>
        <p className="text-primary-foreground/85 mt-auto max-w-[31em] leading-relaxed">
          An order turns to ink once you confirm it. Confirm is the only button
          Solyx fills with ink, and no setting lets the agent press it.
        </p>
      </section>
    </SheetRow>
  );
}
