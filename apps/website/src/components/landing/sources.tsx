import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Badge } from "../ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog.tsx";

import { MODEL_PROVIDERS, ProviderLogo } from "./model-providers.tsx";
import { SheetHead, SheetRow } from "./sheet.tsx";

/** How many providers' logos the model's cell shows before it counts the rest. */
const PROVIDERS_SHOWN = 8;

interface Source {
  purpose: string;
  source: string;
  bring: string[];
  /** What Solyx uses it for, in a few lines. */
  uses: string[];
  /** What is worth knowing before switching it on. */
  notes: string[];
  /** Whether the dialog lists the model providers. */
  providers?: boolean;
}

const SOURCES: Source[] = [
  {
    purpose: "Taiwan quotes and candles",
    source: "Fugle, or Fubon",
    bring: ["A Fugle API key", "or Fubon's SDK and login"],
    uses: [
      "Quotes, daily and intraday candles, and a live stream of one-minute bars.",
      "Taiwan's sector indices, from the same provider.",
    ],
    notes: [
      "Fugle takes an API key and your plan. Basic allows 60 intraday requests a minute and 5 streamed listings, Developer 600 and 300, Advanced 2,000 and 2,000.",
      "For Fubon, download its fubon-neo SDK yourself and point Solyx at the folder, then sign in with your ID number, a Fubon API key and the certificate you export from Fubon's site. The SDK never ships with Solyx.",
      "A failed Fubon sign-in is not tried again on its own, since repeated failures can lock the account.",
      "Closed sessions are cached on your computer, so a chart never downloads them twice.",
    ],
  },
  {
    purpose: "Fundamentals, dividends and investor flows",
    source: "FinMind",
    bring: ["An optional token"],
    uses: [
      "Income statements, balance sheets, cash flows, monthly revenue and dividends.",
      "Each listing's institutional buying and selling, margin and short balances, and foreign holdings.",
      "The market's institutional and margin totals, futures positions and trading calendar.",
    ],
    notes: [
      "Without a token you get 300 requests an hour. A free token raises it to 600, and FinMind's paid plans go further.",
      "A listing's fundamentals are kept for half a day, and its flows until FinMind's next update at 15:00, 18:00 or 21:00 Taipei time.",
    ],
  },
  {
    purpose: "Exchange lists, filings and insider transfers",
    source: "TWSE's and TPEx's open data",
    bring: [],
    uses: [
      "Material information and the insider share transfers declared in advance.",
      "Trading restrictions: short-sale and day-trading suspensions, disposition lists and halts.",
      "The exchanges' P/E and other multiples, ex-dividend notices, shareholders' meetings and each company's industry.",
      "TWSE's list of listed funds and the year's market closures.",
    ],
    notes: [
      "One request per list, never a crawl. Each list holds only its latest day, so Solyx builds the history as it collects.",
      "Only what the exchanges publish as open data is read, since TWSE's own sites forbid programs from downloading theirs.",
    ],
  },
  {
    purpose: "Economic releases and their figures",
    source: "Taiwan's statistics portal and DGBAS",
    bring: [],
    uses: [
      "The release calendar for the next twelve months: CPI, GDP, the economic forecast, trade, industrial production, export orders, the business signal and PMI.",
      "The figures for CPI, advance GDP, trade, export orders, industrial production and the business signal.",
    ],
    notes: [
      "The calendar is read at most twice a day, and the figures, covering the last 26 months, at most once an hour.",
      "The portal is read in a private session that keeps no cookies.",
    ],
  },
  {
    purpose: "The agent's model",
    source: "A model provider of your choice",
    bring: ["An API key", "or a sign-in"],
    uses: [
      "Every reply and tool call the agent makes, on the model you pick for all conversations or for one.",
    ],
    notes: [
      "Pay per request with an API key, or sign in to a plan you already have: ChatGPT for OpenAI, GitHub Copilot, SuperGrok or X Premium for xAI, and Muse for Meta.",
      "OpenRouter's sign-in creates a key that is yours. Ollama runs models on your own computer and needs no key.",
      "You can send a provider's requests to your own gateway; a sign-in only ever goes to the provider itself.",
      "Keys and sign-ins are encrypted with your system's keychain, and a backup never holds them.",
    ],
    providers: true,
  },
  {
    purpose: "Web search and news outlets",
    source: "Firecrawl, Exa or Tavily",
    bring: ["An API key"],
    uses: [
      "The agent's web searches and the pages it reads.",
      "News on the listings you hold and watch: outlets' articles, and posts from Threads for Taiwan and X for the US.",
    ],
    notes: [
      "Pick one vendor. Firecrawl searches Google, while Exa and Tavily search their own indexes.",
      "A search runs on its own. Reading a page asks you first, unless the page came from the conversation's own search.",
      "News is collected every three days by default, so a free tier covers about ten listings. Without a key, filings, insider transfers and PTT's Stock board still come in.",
    ],
  },
];

function ProviderGrid() {
  return (
    <ul
      aria-label="Model providers"
      className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
      {MODEL_PROVIDERS.map((provider) => (
        <li key={provider.name} className="flex items-center gap-2.5">
          <ProviderLogo provider={provider} className="size-4" />
          {provider.name}
        </li>
      ))}
    </ul>
  );
}

function ProviderStrip() {
  const rest = MODEL_PROVIDERS.length - PROVIDERS_SHOWN;

  return (
    <ul
      aria-label="Model providers"
      className="mt-4 flex flex-wrap items-center gap-2.5">
      {MODEL_PROVIDERS.slice(0, PROVIDERS_SHOWN).map((provider) => (
        <li key={provider.name} title={provider.name}>
          <ProviderLogo provider={provider} />
          <span className="sr-only">{provider.name}</span>
        </li>
      ))}
      <li className="text-muted-foreground text-sm">and {rest} more</li>
    </ul>
  );
}

function DetailList({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function SourceCell({
  purpose,
  source,
  bring,
  uses,
  notes,
  providers,
}: Source) {
  return (
    <li className="group relative flex min-h-48 flex-col bg-background px-6 pt-7 pb-8 transition-colors hover:bg-muted/50 md:px-7">
      <Dialog>
        <h3 className="pr-10 font-semibold">
          {/* The title opens the details, and its hit area covers the whole cell. */}
          <DialogTrigger className="focus-visible:after:ring-ring text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset">
            {purpose}
          </DialogTrigger>
        </h3>
        <span
          aria-hidden="true"
          className="text-muted-foreground absolute top-6 right-6 grid size-7 place-items-center rounded-full border border-border transition-colors group-hover:text-foreground">
          <Plus className="size-3.5" />
        </span>
        <p className="text-muted-foreground mt-1.5 text-[0.9375rem]">
          {source}
        </p>
        {providers && <ProviderStrip />}
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

        <DialogContent className={providers ? "sm:max-w-2xl" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle className="pr-8 text-lg">{purpose}</DialogTitle>
            <DialogDescription>{source}</DialogDescription>
          </DialogHeader>
          <DetailList title="What it's for">
            <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-4 leading-relaxed">
              {uses.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </DetailList>
          {providers && (
            <DetailList title="Providers">
              <ProviderGrid />
            </DetailList>
          )}
          <DetailList title="Worth knowing">
            <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-4 leading-relaxed">
              {notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </DetailList>
        </DialogContent>
      </Dialog>
    </li>
  );
}

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
          {SOURCES.map((source) => (
            <SourceCell key={source.purpose} {...source} />
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
