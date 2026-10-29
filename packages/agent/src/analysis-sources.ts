import type { CodemodeTool } from "@earendil-works/pi-codemode";
import { schemaToType } from "@earendil-works/pi-codemode";
import * as z from "zod";

import {
  Investor,
  MONTH_SESSIONS,
  WEEK_SESSIONS,
  netBuying,
} from "@solyx/core/flows";
import type { Flows } from "@solyx/core/flows";
import { revenueTrend, statementMetrics } from "@solyx/core/fundamentals";
import type { Fundamentals } from "@solyx/core/fundamentals";
import {
  Market,
  marketSchema,
  symbolKey,
  symbolRefSchema,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { quoteChange } from "@solyx/core/quote";
import type { SessionQuote } from "@solyx/core/quote";
import { SectorGroup, sectorMoves } from "@solyx/core/sectors";
import type { SectorQuote } from "@solyx/core/sectors";

import { scriptFunction } from "./script-runner.ts";

/** What a script reads beyond bars and the account, each through the host's own reader. */
export interface AnalysisSources {
  /** A listing's newest session against the close before it, as the app's overview reads it; `null` when no source covers its market or has bars for it. */
  quote(symbol: SymbolRef): Promise<SessionQuote | null>;
  /** Every sector index's or fund's session so far in `market`, as the overview's map reads them; `null` while no source covers it. */
  sectors(market: Market): Promise<SectorQuote[] | null>;
  flows: Pick<Flows, "listing">;
  fundamentals: Pick<
    Fundamentals,
    "statements" | "monthlyRevenue" | "multiples" | "dividends" | "company"
  >;
}

/** How many listings one script may read from the sources that count requests. */
export const MAX_LISTINGS = 50;

/**
 * Counts the listings a script reads from a source that counts every request against a limit the
 * rest of the app shares, and refuses the one past `limit` with `refusal`, so a script cannot
 * spend the requests the charts and the calendar also need.
 */
export function listingBudget(
  limit: number,
  refusal: string
): (symbol: SymbolRef) => void {
  const read = new Set<string>();

  return (symbol) => {
    read.add(symbolKey(symbol));

    if (read.size > limit) throw new Error(refusal);
  };
}

/** A budget for the sources below, over one script. */
export const sourceBudget = () =>
  listingBudget(
    MAX_LISTINGS,
    `A script reads the quotes, flows and filings of at most ${MAX_LISTINGS} listings, since their sources count every request against a limit the rest of the app shares. Screen fewer listings.`
  );

// Fields carry no descriptions, which would spread each type over a line a field: what a field
// holds and its unit is said once, by the function that returns it.
const quoteSchema = z.object({
  date: z.string(),
  last: z.number(),
  previousClose: z.number().nullable(),
  change: z.number().nullable(),
  percent: z.number().nullable(),
});

const sectorSchema = z.object({
  sector: z.string(),
  group: z.enum(SectorGroup),
  symbol: z.string(),
  date: z.string(),
  last: z.number(),
  change: z.number(),
  percent: z.number(),
  tradeValue: z.number(),
  share: z.number(),
});

const tradesSchema = z.array(
  z.object({
    date: z.string(),
    investor: z.enum(Investor),
    bought: z.number(),
    sold: z.number(),
  })
);

const marginSchema = z.array(
  z.object({
    date: z.string(),
    margin: z.number(),
    marginLimit: z.number(),
    short: z.number(),
  })
);

const foreignSchema = z.array(
  z.object({ date: z.string(), ratio: z.number(), limit: z.number() })
);

const listingFlowsSchema = z.object({
  trades: tradesSchema,
  margin: marginSchema,
  foreign: foreignSchema,
});

const netBuyingSchema = z.array(
  z.object({
    investor: z.enum(Investor),
    session: z.number(),
    week: z.number(),
    month: z.number(),
    streak: z.number(),
  })
);

const quartersSchema = z.array(
  z.object({
    periodEnd: z.string(),
    knownFrom: z.string(),
    revenue: z.number(),
    grossProfit: z.number().nullable(),
    operatingIncome: z.number().nullable(),
    netIncome: z.number().nullable(),
    eps: z.number().nullable(),
    revenueYoY: z.number().nullable(),
    revenueQoQ: z.number().nullable(),
    grossMargin: z.number().nullable(),
    operatingMargin: z.number().nullable(),
    netMargin: z.number().nullable(),
    epsYoY: z.number().nullable(),
    trailingEps: z.number().nullable(),
  })
);

const monthsSchema = z.array(
  z.object({
    month: z.string(),
    revenue: z.number(),
    yoy: z.number().nullable(),
    mom: z.number().nullable(),
  })
);

const multiplesSchema = z.object({
  asOf: z.string(),
  priceToEarnings: z.number().nullable(),
  dividendYield: z.number().nullable(),
  priceToBook: z.number().nullable(),
});

const companySchema = z.object({
  industry: z.object({ code: z.string(), name: z.string() }),
  shares: z.number().nullable(),
});

const dividendsSchema = z.array(
  z.object({
    period: z.string(),
    announced: z.string().nullable(),
    cash: z.number(),
    stock: z.number(),
    cashExDate: z.string().nullable(),
    cashPaidOn: z.string().nullable(),
    stockExDate: z.string().nullable(),
  })
);

const NAMED = {
  Quote: quoteSchema,
  Sector: sectorSchema,
  InvestorTrades: tradesSchema.element,
  MarginBalance: marginSchema.element,
  ForeignHolding: foreignSchema.element,
  NetBuying: netBuyingSchema.element,
  Quarter: quartersSchema.element,
  MonthRevenue: monthsSchema.element,
  Multiples: multiplesSchema,
  Company: companySchema,
  Dividend: dividendsSchema.element,
};

/** The types the source functions' signatures name, declared once for them all. Dates are YYYY-MM-DD. */
export const SOURCE_TYPES = [
  'type SymbolRef = { market: "TW" | "US"; symbol: string; };',
  ...Object.entries(NAMED).map(
    ([name, schema]) =>
      `type ${name} = ${schemaToType(z.toJSONSchema(schema))};`
  ),
  "type ListingFlows = { trades: InvestorTrades[]; margin: MarginBalance[]; foreign: ForeignHolding[]; };",
].join("\n");

const listing = z.tuple([symbolRefSchema]);

/**
 * The functions a script reads the app's other sources through, each under its source's name.
 * `admit` is asked before a listing is read from a source that counts requests.
 */
export function sourceFunctions(
  sources: AnalysisSources,
  admit: (symbol: SymbolRef) => void
): CodemodeTool[] {
  return [
    scriptFunction({
      name: "market.quote",
      description:
        "A listing's newest session against the close before it, the change as a price and as a fraction of that close, both null without it; null where no source covers its market or has bars for it. One request.",
      spread: true,
      signature: "(symbol: SymbolRef): Promise<Quote | null>",
      input: listing,
      output: quoteSchema.nullable(),
      async run([symbol]) {
        admit(symbol);

        const quote = await sources.quote(symbol);

        if (!quote) return null;

        const moved = quoteChange(quote);

        return {
          date: quote.date,
          last: quote.last,
          previousClose: quote.previousClose,
          change: moved?.change ?? null,
          percent: moved?.percent ?? null,
        };
      },
    }),
    scriptFunction({
      name: "market.sectors",
      description:
        "A market's sectors that have traded in their newest session, Taiwan's unless the US is named, as get_sectors gives them: each index's or, in the US, Select Sector fund's symbol, which tools.candles takes, its move as a fraction, what it traded in the market's currency and that as a fraction of what all the sectors traded. A US fund's value traded is the fund's own, not its sector's.",
      spread: true,
      signature: '(market?: "TW" | "US"): Promise<Sector[]>',
      input: z.tuple([marketSchema.optional()]),
      output: z.array(sectorSchema),
      async run([market = Market.TW]) {
        const sectors = await sources.sectors(market);

        if (!sectors) {
          throw new Error(`No sectors: no market data source covers ${market}`);
        }

        return sectorMoves(sectors).map(({ quote, ...move }) => ({
          ...move,
          date: quote.date,
          last: quote.last,
          tradeValue: quote.tradeValue,
        }));
      },
    }),
    scriptFunction({
      name: "flows.listing",
      description:
        "Who traded a Taiwan listing over the last year of sessions, each list oldest first: the shares each investor group bought and sold; the shares bought on margin and still held, the exchange's limit on them, and the shares sold short; and what foreign investors hold as a fraction of the shares issued, with their limit. Three requests a listing, kept until the next session's figures are out.",
      spread: true,
      signature: "(symbol: SymbolRef): Promise<ListingFlows>",
      input: listing,
      output: listingFlowsSchema,
      run([symbol]) {
        admit(symbol);

        return sources.flows.listing(symbol);
      },
    }),
    scriptFunction({
      name: "flows.netBuying",
      description: `Each group's net buying over the newest session, a week (${WEEK_SESSIONS}) and a month (${MONTH_SESSIONS}) of sessions, with its streak of sessions on the newest one's side, negative for selling, as get_flows computes them. Reads nothing.`,
      spread: true,
      signature: "(trades: InvestorTrades[]): Promise<NetBuying[]>",
      input: z.tuple([tradesSchema]),
      output: netBuyingSchema,
      run: ([trades]) => netBuying(trades),
    }),
    scriptFunction({
      name: "fundamentals.statements",
      description:
        "A listing's quarterly income statements, oldest first, each for that quarter alone and public from knownFrom, with what get_fundamentals computes: margins and growth as fractions, and the EPS of the quarter and the three before it. A request a listing, kept half a day.",
      spread: true,
      signature: "(symbol: SymbolRef): Promise<Quarter[]>",
      input: listing,
      output: quartersSchema,
      async run([symbol]) {
        admit(symbol);

        return statementMetrics(
          await sources.fundamentals.statements(symbol)
        ).map(({ statement, ...metrics }) => ({ ...statement, ...metrics }));
      },
    }),
    scriptFunction({
      name: "fundamentals.monthlyRevenue",
      description:
        "A Taiwan listing's monthly revenue, oldest first, with its growth on the year and on the month as fractions. A request a listing, kept half a day.",
      spread: true,
      signature: "(symbol: SymbolRef): Promise<MonthRevenue[]>",
      input: listing,
      output: monthsSchema,
      async run([symbol]) {
        admit(symbol);

        return revenueTrend(await sources.fundamentals.monthlyRevenue(symbol));
      },
    }),
    scriptFunction({
      name: "fundamentals.multiples",
      description:
        "What a listing trades at against its earnings and book value, and its dividend yield in percent, as its exchange works them out from a session's close; null where it lists none, as for a fund. Read from a list of the whole market, so it costs no request of its own.",
      spread: true,
      signature: "(symbol: SymbolRef): Promise<Multiples | null>",
      input: listing,
      output: multiplesSchema.nullable(),
      run: ([symbol]) => sources.fundamentals.multiples(symbol),
    }),
    scriptFunction({
      name: "fundamentals.company",
      description:
        "A Taiwan company as its exchange lists it: the industry it classes it in, by its code and name, and the common shares it has issued, which times a close is its market value and divides a session's volume into its turnover; null for a listing it lists as no company, as a fund. Read from a list of the whole market, so it costs no request of its own.",
      spread: true,
      signature: "(symbol: SymbolRef): Promise<Company | null>",
      input: listing,
      output: companySchema.nullable(),
      run: ([symbol]) => sources.fundamentals.company(symbol),
    }),
    scriptFunction({
      name: "fundamentals.dividends",
      description:
        "The distributions a company decided on: cash per share, and stock per share at par value, with the first sessions its shares trade without each. A request a listing, kept half a day.",
      spread: true,
      signature: "(symbol: SymbolRef): Promise<Dividend[]>",
      input: listing,
      output: dividendsSchema,
      run([symbol]) {
        admit(symbol);

        return sources.fundamentals.dividends(symbol);
      },
    }),
  ];
}
