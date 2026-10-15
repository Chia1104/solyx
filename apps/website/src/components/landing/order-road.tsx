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
    <section className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="text-3xl font-[640] tracking-[-0.015em] [font-stretch:112%]">
        One road to an order
      </h2>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">
        Every order takes these five steps. No setting, mode or extension adds
        another way to the broker.
      </p>

      <ol className="mt-12 grid gap-8 md:grid-cols-5 md:gap-0">
        {STEPS.map((step, index) => {
          const inked = index >= CONFIRM;

          return (
            <li
              key={step.title}
              className="relative pl-10 md:pt-10 md:pr-6 md:pl-0">
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`absolute top-3 bottom-[-2rem] left-3 w-0 border-l-2 md:right-0 md:bottom-auto md:left-3 md:h-0 md:w-auto md:border-t-2 md:border-l-0 ${
                    inked ? "border-ink" : "border-graphite border-dashed"
                  }`}
                />
              )}
              <span
                aria-hidden="true"
                className={`absolute top-0 left-0 size-6.5 rounded-full border-2 ${
                  inked
                    ? "border-ink bg-ink"
                    : "border-graphite bg-paper border-dashed"
                }`}
              />
              <p className="text-sm text-muted">{index + 1}</p>
              <h3 className="mt-1 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {step.detail}
              </p>
            </li>
          );
        })}
      </ol>

      <p className="mt-12 max-w-2xl leading-relaxed">
        A failed submission is never retried, since the broker may have taken
        the order anyway. Solyx marks it failed and leaves the next move to you.
      </p>
    </section>
  );
}
