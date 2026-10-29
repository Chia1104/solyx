import { HISTORY_YEARS } from "@solyx/core/candles";
import { peerStanding } from "@solyx/core/fundamentals";
import type {
  ExchangeListsProvider,
  FundReportsProvider,
  Fundamentals,
  FundamentalsProvider,
} from "@solyx/core/fundamentals";
import { Market, exchangeDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { sectorMovers } from "@solyx/core/sectors";
import { HOUR_MS } from "@solyx/utils/date";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

// Five years of quarters, so a multiple three years back still has four quarters behind it.
const STATEMENT_YEARS = 5;

// Three years of balance sheets and cash flows, so each recent quarter has the three before it and the same one a year back.
const SHEET_YEARS = 3;

const REVENUE_MONTHS = 36;

// As far back as a backtest reads daily bars, so each session it holds through has its cash.
const DISTRIBUTION_YEARS = HISTORY_YEARS;

// A quarter or a month is published once, so a listing is asked about twice a day at most.
const FRESH_MS = 12 * HOUR_MS;

// One read answers for every listing, so a list an exchange draws up each day is read once an hour at most.
const DAILY_LIST_FRESH_MS = HOUR_MS;

export interface FundamentalsOptions {
  /** One per market at most; the first that covers a listing's market answers for it. */
  providers: readonly FundamentalsProvider[];
  /** The sources of the exchanges' own lists, one per market at most. */
  exchanges: readonly ExchangeListsProvider[];
  /** The sources of what listed funds report of themselves, one per market at most. */
  fundReports: readonly FundReportsProvider[];
  /** Where each listing's answers, and each market's lists, are kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

interface Ask {
  symbol: SymbolRef;
  provider: FundamentalsProvider;
}

/** A source that answers for a whole market at once. */
interface MarketSource {
  readonly id: string;
  readonly markets: readonly Market[];
}

interface ListAsk<Source> {
  market: Market;
  provider: Source;
}

/**
 * Every market's fundamentals from the provider that covers it, each listing's answer kept for
 * half a day, since research asks for the newest quarter far more often than one comes out, and
 * what its exchanges list of it from the source of their lists, a market's kept whole: its funds
 * and shareholders' meetings for half a day, and the lists an exchange draws up each day for an hour.
 * A fund's net asset value and costs come from the source of what funds report, a market's kept
 * whole too: the values for an hour, since one is struck after each session, and the costs of a
 * month for half a day.
 */
export function createFundamentals({
  providers,
  exchanges,
  fundReports,
  answers,
  now = () => new Date(),
}: FundamentalsOptions): Fundamentals {
  const covering = (market: Market) =>
    providers.find(({ markets }) => markets.includes(market));

  /** A market's list from the one of `sources` that covers it, kept whole under `scope`, and the rows of it that are a listing's. */
  function listed<Source extends MarketSource, Row extends { symbol: string }>(
    scope: string,
    sources: readonly Source[],
    ask: (provider: Source, market: Market) => Promise<Row[]>,
    freshMs: number
  ) {
    const read = keepFresh<ListAsk<Source>, Row[]>({
      store: answers(`fundamentals:${scope}`),
      id: ({ provider, market }) => `${provider.id}:${market}`,
      ask: ({ provider, market }) => ask(provider, market),
      fresh: freshFor(freshMs),
      // The exchanges' CDN can answer a list in another format, such as CSV, for hours, so a
      // list that fails to read again stands as last read.
      keepOnFailure: true,
      now: () => now().getTime(),
    });

    /** A market's whole list; none for a market no source lists. */
    const all = (market: Market): Promise<Row[]> => {
      const provider = sources.find(({ markets }) => markets.includes(market));

      return provider ? read({ market, provider }) : Promise.resolve([]);
    };

    return {
      all,
      of: async ({ market, symbol }: SymbolRef) =>
        (await all(market)).flatMap(({ symbol: code, ...row }) =>
          code === symbol ? [row] : []
        ),
    };
  }

  const funds = listed(
    "funds",
    exchanges,
    (provider, market) => provider.getFunds(market),
    FRESH_MS
  );

  const multiples = listed(
    "multiples",
    exchanges,
    (provider, market) => provider.getMultiples(market),
    DAILY_LIST_FRESH_MS
  );

  const netAssetValues = listed(
    "net-asset-values",
    fundReports,
    (provider, market) => provider.getNetAssetValues(market),
    DAILY_LIST_FRESH_MS
  );

  const fundCosts = listed(
    "fund-costs",
    fundReports,
    (provider, market) => provider.getCosts(market),
    FRESH_MS
  );

  const companies = listed(
    "companies",
    exchanges,
    (provider, market) => provider.getCompanies(market),
    FRESH_MS
  );

  const priceLimits = listed(
    "price-limits",
    exchanges,
    (provider, market) => provider.getPriceLimits(market),
    DAILY_LIST_FRESH_MS
  );

  const governance = listed(
    "governance",
    exchanges,
    (provider, market) => provider.getGovernance(market),
    FRESH_MS
  );

  const sectorCloses = listed(
    "sector-closes",
    exchanges,
    (provider, market) => provider.getSectorCloses(market),
    DAILY_LIST_FRESH_MS
  );

  const listingNames = listed(
    "listing-names",
    exchanges,
    (provider, market) => provider.getListingNames(market),
    DAILY_LIST_FRESH_MS
  );

  /** `ask`'s answer per listing, kept under `scope`. */
  function fresh<Answer>(
    scope: string,
    ask: (
      provider: FundamentalsProvider,
      symbol: SymbolRef,
      today: Temporal.PlainDate
    ) => Promise<Answer[]>
  ) {
    const read = keepFresh<Ask, Answer[]>({
      store: answers(`fundamentals:${scope}`),
      id: ({ provider, symbol }) => `${provider.id}:${symbolKey(symbol)}`,
      ask: ({ provider, symbol }) =>
        ask(
          provider,
          symbol,
          Temporal.PlainDate.from(exchangeDate(symbol.market, now()))
        ),
      fresh: freshFor(FRESH_MS),
      now: () => now().getTime(),
    });

    return (symbol: SymbolRef): Promise<Answer[]> => {
      const provider = covering(symbol.market);

      return provider ? read({ provider, symbol }) : Promise.resolve([]);
    };
  }

  return {
    source: (market) => covering(market)?.id,

    statements: fresh("statements", (provider, symbol, today) =>
      provider.getStatements(
        symbol,
        today.subtract({ years: STATEMENT_YEARS }).toString()
      )
    ),

    balanceSheets: fresh("balance-sheets", (provider, symbol, today) =>
      provider.getBalanceSheets(
        symbol,
        today.subtract({ years: SHEET_YEARS }).toString()
      )
    ),

    cashFlows: fresh("cash-flows", (provider, symbol, today) =>
      provider.getCashFlows(
        symbol,
        today.subtract({ years: SHEET_YEARS }).toString()
      )
    ),

    monthlyRevenue: fresh("monthly-revenue", (provider, symbol, today) =>
      provider.getMonthlyRevenue(
        symbol,
        today.toPlainYearMonth().subtract({ months: REVENUE_MONTHS }).toString()
      )
    ),

    reportDates: fresh("report-dates", (provider, symbol) =>
      provider.getReportDates(symbol)
    ),

    dividends: fresh("dividends", (provider, symbol, today) =>
      provider.getDividends(
        symbol,
        today.subtract({ years: DISTRIBUTION_YEARS }).toString()
      )
    ),

    restrictions: listed(
      "restrictions",
      exchanges,
      (provider, market) => provider.getRestrictions(market),
      DAILY_LIST_FRESH_MS
    ).of,

    fund: async (symbol) => (await funds.of(symbol)).at(0) ?? null,

    netAssetValue: async (symbol) =>
      (await netAssetValues.of(symbol)).at(0) ?? null,

    fundCosts: async (symbol) => (await fundCosts.of(symbol)).at(0) ?? null,

    multiples: async (symbol) => (await multiples.of(symbol)).at(0) ?? null,

    async peers({ market, symbol }) {
      const [classed, worked] = await Promise.all([
        companies.all(market),
        multiples.all(market),
      ]);

      const own = classed.find((each) => each.symbol === symbol);
      const ownMultiples = worked.find((each) => each.symbol === symbol);

      if (!own || !ownMultiples) return null;

      const others = new Set(
        classed
          .filter(
            (each) =>
              each.industry.code === own.industry.code && each.symbol !== symbol
          )
          .map((each) => each.symbol)
      );

      return {
        industry: own.industry,
        listings: others.size + 1,
        asOf: ownMultiples.asOf,
        ...peerStanding(
          ownMultiples,
          worked.filter((each) => others.has(each.symbol))
        ),
      };
    },

    exNotices: listed(
      "ex-notices",
      exchanges,
      (provider, market) => provider.getExNotices(market),
      DAILY_LIST_FRESH_MS
    ).of,

    meetings: listed(
      "meetings",
      exchanges,
      (provider, market) => provider.getMeetings(market),
      FRESH_MS
    ).of,

    company: async (symbol) => (await companies.of(symbol)).at(0) ?? null,

    governance: governance.of,

    async sectorMovers(sector) {
      const [listed, closes] = await Promise.all([
        companies.all(Market.TW),
        sectorCloses.all(Market.TW),
      ]);

      return sectorMovers(sector, listed, closes);
    },

    priceLimits: async (symbol) => (await priceLimits.of(symbol)).at(0) ?? null,

    listingNames: listingNames.all,
  };
}
