import { Link } from "@tanstack/react-router";

const SOURCES = [
  {
    purpose: "Taiwan quotes and candles",
    source: "Fugle, or Fubon",
    bring: "A Fugle API key, or Fubon's SDK and login",
  },
  {
    purpose: "Fundamentals, dividends and investor flows",
    source: "FinMind",
    bring: "Nothing; a token raises the limit",
  },
  {
    purpose: "Exchange lists, filings and insider transfers",
    source: "TWSE's and TPEx's open data",
    bring: "Nothing",
  },
  {
    purpose: "Economic releases and their figures",
    source: "Taiwan's statistics portal and DGBAS",
    bring: "Nothing",
  },
  {
    purpose: "The agent's model",
    source: "A model provider of your choice",
    bring: "An API key, or a ChatGPT sign-in",
  },
  {
    purpose: "Web search and news outlets",
    source: "Firecrawl, Exa or Tavily",
    bring: "An API key",
  },
];

export function Sources() {
  return (
    <section className="border-rule bg-sheet border-t">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-3xl font-[640] tracking-[-0.015em] [font-stretch:112%]">
          Runs on your keys
        </h2>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">
          Market data and a model are enough to start. Every key is saved
          encrypted on your computer, and data flows straight between each
          provider and you, with no Solyx server between.
        </p>

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead>
              <tr className="border-text border-b text-sm">
                <th scope="col" className="py-3 pr-6 font-semibold">
                  For
                </th>
                <th scope="col" className="py-3 pr-6 font-semibold">
                  Source
                </th>
                <th scope="col" className="py-3 font-semibold">
                  You bring
                </th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map(({ purpose, source, bring }) => (
                <tr key={purpose} className="border-rule border-b">
                  <td className="py-3 pr-6">{purpose}</td>
                  <td className="py-3 pr-6 text-muted">{source}</td>
                  <td className="py-3 text-muted">{bring}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-muted">
          Decisions models and embedders add more.{" "}
          <Link
            to="/docs/$"
            params={{ _splat: "keys" }}
            className="text-ink underline underline-offset-4">
            See every source
          </Link>
        </p>
      </div>
    </section>
  );
}
