/** The app's two marks, each shown on the proposal it marks. */
export function Legend() {
  return (
    <section className="border-rule bg-sheet border-y">
      <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-6 py-24 md:grid-cols-2">
        <div className="md:col-span-2">
          <h2 className="text-3xl font-[640] tracking-[-0.015em] [font-stretch:112%]">
            Read it like a drafting sheet
          </h2>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">
            Solyx draws two kinds of line, so you can tell at a glance what is
            only a draft.
          </p>
        </div>

        <div>
          <div
            aria-hidden="true"
            className="flex items-baseline justify-between rounded-md pencil px-5 py-6">
            <span className="text-lg font-semibold">Buy 1,000 @ 4,375</span>
            <span className="text-sm text-muted">Awaiting confirmation</span>
          </div>
          <h3 className="mt-6 text-xl font-semibold">Pencil is a draft</h3>
          <p className="mt-2 leading-relaxed text-muted">
            Hatching and dashed outlines mark what is not real yet: a proposal
            waiting for you, a forecast, the paper account. Nothing drawn in
            pencil has reached a broker.
          </p>
        </div>

        <div>
          <div
            aria-hidden="true"
            className="border-ink bg-ink/8 flex items-baseline justify-between rounded-md border px-5 py-6">
            <span className="text-lg font-semibold">Buy 1,000 @ 4,375</span>
            <span className="text-ink text-sm">Submitted</span>
          </div>
          <h3 className="mt-6 text-xl font-semibold">Ink is what you signed</h3>
          <p className="mt-2 leading-relaxed text-muted">
            An order turns to ink once you confirm it. Confirm is the only
            button Solyx fills with ink, and no setting lets the agent press it.
          </p>
        </div>
      </div>
    </section>
  );
}
