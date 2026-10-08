import type {
  Fundamentals,
  FundamentalsProvider,
} from "@solyx/core/fundamentals";
import { exchangeDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores, KeptFresh } from "@solyx/utils/fresh";

// Five years of quarters, so a multiple three years back still has four quarters behind it.
const STATEMENT_YEARS = 5;

const REVENUE_MONTHS = 36;

// A quarter or a month is published once, so a listing is asked about twice a day at most.
const FRESH_MS = 12 * 60 * 60 * 1000;

export interface FundamentalsOptions {
  /** One per market at most; the first that covers a listing's market answers for it. */
  providers: readonly FundamentalsProvider[];
  /** Where each listing's answers are kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

interface Ask {
  symbol: SymbolRef;
  provider: FundamentalsProvider;
}

/**
 * Every market's fundamentals from the provider that covers it, each listing's answer kept for
 * half a day, since research asks for the newest quarter far more often than one comes out.
 */
export function createFundamentals({
  providers,
  answers,
  now = () => new Date(),
}: FundamentalsOptions): Fundamentals & {
  /** Drops every answer kept, for when what a provider may read changes, as with the user's plan. */
  forget(): void;
} {
  const kept: KeptFresh<Ask, unknown>[] = [];

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

    kept.push(read);

    return (symbol: SymbolRef): Promise<Answer[]> => {
      const provider = providers.find(({ markets }) =>
        markets.includes(symbol.market)
      );

      return provider ? read({ provider, symbol }) : Promise.resolve([]);
    };
  }

  return {
    forget() {
      for (const read of kept) read.forget();
    },

    statements: fresh("statements", (provider, symbol, today) =>
      provider.getStatements(
        symbol,
        today.subtract({ years: STATEMENT_YEARS }).toString()
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

    restrictions: fresh("restrictions", (provider, symbol, today) =>
      provider.getRestrictions(symbol, today.subtract({ years: 1 }).toString())
    ),
  };
}
