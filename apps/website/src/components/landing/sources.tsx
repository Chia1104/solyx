import { Link } from "@tanstack/react-router";

import { Badge } from "../ui/badge.tsx";

import { SheetHead, SheetRow } from "./sheet.tsx";

const SOURCES = [
  {
    purpose: "Taiwan quotes and candles",
    source: "Fugle, or Fubon",
    bring: ["A Fugle API key", "or Fubon's SDK and login"],
  },
  {
    purpose: "Fundamentals, dividends and investor flows",
    source: "FinMind",
    bring: ["An optional token"],
  },
  {
    purpose: "Exchange lists, filings and insider transfers",
    source: "TWSE's and TPEx's open data",
    bring: [],
  },
  {
    purpose: "Economic releases and their figures",
    source: "Taiwan's statistics portal and DGBAS",
    bring: [],
  },
  {
    purpose: "The agent's model",
    source: "A model provider of your choice",
    bring: ["An API key", "or a ChatGPT sign-in"],
  },
  {
    purpose: "Web search and news outlets",
    source: "Firecrawl, Exa or Tavily",
    bring: ["An API key"],
  },
];

export function Sources() {
  return (
    <>
      <SheetRow>
        <SheetHead id="sources" title="Runs on your keys">
          Market data and a model are enough to start. Every key is saved
          encrypted on your computer, and data flows straight between each
          provider and you, with no Solyx server between.
        </SheetHead>
      </SheetRow>

      <SheetRow>
        <ul
          aria-labelledby="sources"
          className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {SOURCES.map(({ purpose, source, bring }) => (
            <li
              key={purpose}
              className="flex min-h-48 flex-col bg-background px-6 pt-7 pb-8 md:px-7">
              <h3 className="font-semibold">{purpose}</h3>
              <p className="text-muted-foreground mt-1.5 text-[0.9375rem]">
                {source}
              </p>
              <p className="mt-auto flex flex-wrap gap-1.5 pt-5">
                {bring.length > 0 ? (
                  bring.map((thing) => (
                    <Badge key={thing} variant="outline" className="h-6 px-2.5">
                      {thing}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground text-sm">
                    Nothing to bring
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      </SheetRow>

      <SheetRow>
        <p className="text-muted-foreground px-6 py-7 md:px-10">
          Decisions models and embedders add more.{" "}
          <Link
            to="/docs/$"
            params={{ _splat: "keys" }}
            className="text-primary underline underline-offset-4">
            See every source
          </Link>
        </p>
      </SheetRow>
    </>
  );
}
