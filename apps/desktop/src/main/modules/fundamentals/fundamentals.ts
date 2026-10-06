import type {
  Fundamentals,
  FundamentalsProvider,
} from "@solyx/core/fundamentals";
import { exchangeDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

// Five years of quarters, so a multiple three years back still has four quarters behind it.
const STATEMENT_YEARS = 5;

const REVENUE_MONTHS = 36;

// A quarter or a month is published once, so a listing is asked about twice a day at most.
const FRESH_MS = 12 * 60 * 60 * 1000;

export interface FundamentalsOptions {
  /** One per market at most; the first that covers a listing's market answers for it. */
  providers: readonly FundamentalsProvider[];
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Every market's fundamentals from the provider that covers it, each listing's answer kept for
 * half a day, since research asks for the newest quarter far more often than one comes out.
 */
export function createFundamentals({
  providers,
  now = () => new Date(),
}: FundamentalsOptions): Fundamentals {
  /** `ask`'s answer per listing, asked again once it is stale or after it failed. */
  function fresh<Answer>(
    ask: (
      provider: FundamentalsProvider,
      symbol: SymbolRef,
      today: Temporal.PlainDate
    ) => Promise<Answer[]>
  ) {
    const kept = new Map<string, { at: number; answer: Promise<Answer[]> }>();

    return (symbol: SymbolRef): Promise<Answer[]> => {
      const provider = providers.find(({ markets }) =>
        markets.includes(symbol.market)
      );

      if (!provider) return Promise.resolve([]);

      const key = `${provider.id}:${symbolKey(symbol)}`;
      const at = now().getTime();
      const held = kept.get(key);

      if (held && at - held.at < FRESH_MS) return held.answer;

      const answer = ask(
        provider,
        symbol,
        Temporal.PlainDate.from(exchangeDate(symbol.market, now()))
      );

      kept.set(key, { at, answer });

      answer.catch(() => {
        if (kept.get(key)?.answer === answer) kept.delete(key);
      });

      return answer;
    };
  }

  return {
    statements: fresh((provider, symbol, today) =>
      provider.getStatements(
        symbol,
        today.subtract({ years: STATEMENT_YEARS }).toString()
      )
    ),

    monthlyRevenue: fresh((provider, symbol, today) =>
      provider.getMonthlyRevenue(
        symbol,
        today.toPlainYearMonth().subtract({ months: REVENUE_MONTHS }).toString()
      )
    ),
  };
}
