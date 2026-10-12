import type {
  ExchangeListsProvider,
  Fundamentals,
  FundamentalsProvider,
} from "@solyx/core/fundamentals";
import { exchangeDate, symbolKey } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

// Five years of quarters, so a multiple three years back still has four quarters behind it.
const STATEMENT_YEARS = 5;

// Three years of balance sheets and cash flows, so each recent quarter has the three before it and the same one a year back.
const SHEET_YEARS = 3;

const REVENUE_MONTHS = 36;

// A quarter or a month is published once, so a listing is asked about twice a day at most.
const FRESH_MS = 12 * 60 * 60 * 1000;

// One read answers for every listing, so a list an exchange draws up each day is read once an hour at most.
const DAILY_LIST_FRESH_MS = 60 * 60 * 1000;

export interface FundamentalsOptions {
  /** One per market at most; the first that covers a listing's market answers for it. */
  providers: readonly FundamentalsProvider[];
  /** The sources of the exchanges' own lists, one per market at most. */
  exchanges: readonly ExchangeListsProvider[];
  /** Where each listing's answers, and each market's lists, are kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

interface Ask {
  symbol: SymbolRef;
  provider: FundamentalsProvider;
}

interface ListAsk {
  market: Market;
  provider: ExchangeListsProvider;
}

/**
 * Every market's fundamentals from the provider that covers it, each listing's answer kept for
 * half a day, since research asks for the newest quarter far more often than one comes out, and
 * what its exchanges list of it from the source of their lists, a market's kept whole: its funds
 * and shareholders' meetings for half a day, and the lists an exchange draws up each day for an hour.
 */
export function createFundamentals({
  providers,
  exchanges,
  answers,
  now = () => new Date(),
}: FundamentalsOptions): Fundamentals {
  const covering = (market: Market) =>
    providers.find(({ markets }) => markets.includes(market));

  /** A market's list from the source of its exchanges', kept whole under `scope`, and the rows of it that are a listing's. */
  function listed<Row extends { symbol: string }>(
    scope: string,
    ask: (provider: ExchangeListsProvider, market: Market) => Promise<Row[]>,
    freshMs: number
  ) {
    const read = keepFresh<ListAsk, Row[]>({
      store: answers(`fundamentals:${scope}`),
      id: ({ provider, market }) => `${provider.id}:${market}`,
      ask: ({ provider, market }) => ask(provider, market),
      fresh: freshFor(freshMs),
      now: () => now().getTime(),
    });

    return async ({ market, symbol }: SymbolRef) => {
      const provider = exchanges.find(({ markets }) =>
        markets.includes(market)
      );

      if (!provider) return [];

      return (await read({ market, provider })).flatMap(
        ({ symbol: code, ...row }) => (code === symbol ? [row] : [])
      );
    };
  }

  const funds = listed(
    "funds",
    (provider, market) => provider.getFunds(market),
    FRESH_MS
  );

  const multiples = listed(
    "multiples",
    (provider, market) => provider.getMultiples(market),
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

    dividends: fresh("dividends", (provider, symbol, today) =>
      provider.getDividends(
        symbol,
        today.subtract({ years: STATEMENT_YEARS }).toString()
      )
    ),

    restrictions: listed(
      "restrictions",
      (provider, market) => provider.getRestrictions(market),
      DAILY_LIST_FRESH_MS
    ),

    fund: async (symbol) => (await funds(symbol)).at(0) ?? null,

    multiples: async (symbol) => (await multiples(symbol)).at(0) ?? null,

    exNotices: listed(
      "ex-notices",
      (provider, market) => provider.getExNotices(market),
      DAILY_LIST_FRESH_MS
    ),

    meetings: listed(
      "meetings",
      (provider, market) => provider.getMeetings(market),
      FRESH_MS
    ),
  };
}
