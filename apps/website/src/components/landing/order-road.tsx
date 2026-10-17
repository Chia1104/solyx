import { cn } from "cn";

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

export function OrderRoad() {
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
          aria-labelledby="order-road"
          className="grid gap-px bg-border md:grid-cols-5">
          {STEPS.map((step, index) => {
            const inked = index >= CONFIRM;

            return (
              <li
                key={step.title}
                className="relative bg-background px-6 pt-7 pb-9 md:px-5">
                {index < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-[2.375rem] left-[2.625rem] z-10 hidden w-[calc(100%-1.3125rem)] border-t-2 md:block",
                      inked ? "border-primary" : "border-graphite border-dashed"
                    )}
                  />
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative z-20 block size-[1.375rem] rounded-full border-2",
                    inked
                      ? "border-primary bg-primary"
                      : "border-graphite border-dashed bg-background"
                  )}
                />
                <p className="text-muted-foreground mt-4 text-sm">
                  {index + 1}
                </p>
                <h3 className="mt-0.5 font-semibold">{step.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-[0.9375rem] leading-relaxed">
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
