import type {
  Fundamentals,
  FundamentalsProvider,
  FundsProvider,
  ListedFund,
  ListedRestriction,
  RestrictionsProvider,
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

// One read answers for every listing, so a market's restrictions are read once an hour at most.
const RESTRICTIONS_FRESH_MS = 60 * 60 * 1000;

export interface FundamentalsOptions {
  /** One per market at most; the first that covers a listing's market answers for it. */
  providers: readonly FundamentalsProvider[];
  /** The sources of the exchanges' own lists of restrictions, one per market at most. */
  restrictions: readonly RestrictionsProvider[];
  /** The sources of the exchanges' own lists of funds, one per market at most. */
  funds: readonly FundsProvider[];
  /** Where each listing's answers, and each market's restrictions and funds, are kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

interface Ask {
  symbol: SymbolRef;
  provider: FundamentalsProvider;
}

interface ListAsk<Provider> {
  market: Market;
  provider: Provider;
}

/**
 * Every market's fundamentals from the provider that covers it, each listing's answer kept for
 * half a day, since research asks for the newest quarter far more often than one comes out, and
 * its restrictions and what it is as a fund from the sources of its exchanges' lists, a market's
 * kept whole, restrictions for an hour and funds for half a day.
 */
export function createFundamentals({
  providers,
  restrictions,
  funds,
  answers,
  now = () => new Date(),
}: FundamentalsOptions): Fundamentals {
  const covering = (market: Market) =>
    providers.find(({ markets }) => markets.includes(market));

  const listed = keepFresh<ListAsk<RestrictionsProvider>, ListedRestriction[]>({
    store: answers("fundamentals:restrictions"),
    id: ({ provider, market }) => `${provider.id}:${market}`,
    ask: ({ provider, market }) => provider.getRestrictions(market),
    fresh: freshFor(RESTRICTIONS_FRESH_MS),
    now: () => now().getTime(),
  });

  const listedFunds = keepFresh<ListAsk<FundsProvider>, ListedFund[]>({
    store: answers("fundamentals:funds"),
    id: ({ provider, market }) => `${provider.id}:${market}`,
    ask: ({ provider, market }) => provider.getFunds(market),
    fresh: freshFor(FRESH_MS),
    now: () => now().getTime(),
  });

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

    async restrictions({ market, symbol }) {
      const provider = restrictions.find(({ markets }) =>
        markets.includes(market)
      );

      if (!provider) return [];

      return (await listed({ market, provider })).flatMap(
        ({ symbol: code, ...restriction }) =>
          code === symbol ? [restriction] : []
      );
    },

    async fund({ market, symbol }) {
      const provider = funds.find(({ markets }) => markets.includes(market));

      if (!provider) return null;

      const [profile = null] = (
        await listedFunds({ market, provider })
      ).flatMap(({ symbol: code, ...fund }) => (code === symbol ? [fund] : []));

      return profile;
    },
  };
}
