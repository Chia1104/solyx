import { candleDate } from "./candles.ts";
import type { Candle } from "./candles.ts";
import type { Market, SymbolRef } from "./market.ts";

/** One quarter's income statement, for that quarter alone, in the market's currency. */
export interface QuarterStatement {
  /** The quarter's last day, `YYYY-MM-DD`. */
  periodEnd: string;
  /** The exchange-local date its figures were public: the filing's where the provider tells it, else the filing deadline. */
  knownFrom: string;
  revenue: number;
  /** `null` where the industry reports none, as banks do. */
  grossProfit: number | null;
  operatingIncome: number | null;
  /** Attributable to the parent's owners. */
  netIncome: number | null;
  /** Basic, per share. */
  eps: number | null;
}

export interface MonthlyRevenue {
  /** `YYYY-MM`. */
  month: string;
  revenue: number;
}

/** One implementation per provider (`@solyx/fundamentals/*`); it runs only in the main process. */
export interface FundamentalsProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Quarters ending on or after `since` (`YYYY-MM-DD`), oldest first; none for a listing without statements, such as an ETF. */
  getStatements(symbol: SymbolRef, since: string): Promise<QuarterStatement[]>;
  /** Months from `since` (`YYYY-MM`) on, oldest first; none where the market reports none. */
  getMonthlyRevenue(
    symbol: SymbolRef,
    since: string
  ): Promise<MonthlyRevenue[]>;
}

/** A listing's fundamentals from whichever provider covers its market, oldest first; none while no provider does. */
export interface Fundamentals {
  /** Enough quarters to compare each recent one with the year before. */
  statements(symbol: SymbolRef): Promise<QuarterStatement[]>;
  monthlyRevenue(symbol: SymbolRef): Promise<MonthlyRevenue[]>;
}

/** A quarter with what it says against the quarters around it; `null` where a figure it needs is missing. */
export interface StatementMetrics {
  statement: QuarterStatement;
  revenueYoY: number | null;
  revenueQoQ: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  epsYoY: number | null;
  /** This quarter's EPS and the three before it. */
  trailingEps: number | null;
}

export interface RevenueTrend {
  month: string;
  revenue: number;
  yoy: number | null;
  mom: number | null;
}

/** The change from `before` as a share of it, measured against its size so a loss turning to profit reads as a rise. */
function growth(
  now: number | null | undefined,
  before: number | null | undefined
): number | null {
  if (now === null || now === undefined) return null;

  if (before === null || before === undefined || before === 0) return null;

  return (now - before) / Math.abs(before);
}

const share = (part: number | null, whole: number) =>
  part === null || whole === 0 ? null : part / whole;

/** `YYYY-MM` moved by whole months. */
const shiftMonth = (month: string, months: number) =>
  Temporal.PlainYearMonth.from(month).add({ months }).toString();

const monthOf = (statement: QuarterStatement) =>
  statement.periodEnd.slice(0, 7);

/** Each quarter against the one before and the one a year before, oldest first as given. */
export function statementMetrics(
  statements: readonly QuarterStatement[]
): StatementMetrics[] {
  const byMonth = new Map(
    statements.map((statement) => [monthOf(statement), statement])
  );

  return statements.map((statement) => {
    const month = monthOf(statement);
    const before = (months: number) => byMonth.get(shiftMonth(month, -months));
    const yearAgo = before(12);

    const year = [statement, before(3), before(6), before(9)].map(
      (quarter) => quarter?.eps ?? null
    );

    return {
      statement,
      revenueYoY: growth(statement.revenue, yearAgo?.revenue),
      revenueQoQ: growth(statement.revenue, before(3)?.revenue),
      grossMargin: share(statement.grossProfit, statement.revenue),
      operatingMargin: share(statement.operatingIncome, statement.revenue),
      netMargin: share(statement.netIncome, statement.revenue),
      epsYoY: growth(statement.eps, yearAgo?.eps),
      trailingEps: year.includes(null)
        ? null
        : year.reduce<number>((sum, eps) => sum + (eps ?? 0), 0),
    };
  });
}

/** Each month against the one before and the same month a year before, oldest first as given. */
export function revenueTrend(
  monthly: readonly MonthlyRevenue[]
): RevenueTrend[] {
  const byMonth = new Map(monthly.map((each) => [each.month, each.revenue]));

  return monthly.map(({ month, revenue }) => ({
    month,
    revenue,
    yoy: growth(revenue, byMonth.get(shiftMonth(month, -12))),
    mom: growth(revenue, byMonth.get(shiftMonth(month, -1))),
  }));
}

/**
 * Each bar's close over the trailing EPS that was public on its day, so a past multiple never
 * leans on results the market had not seen. Bars are left out before four quarters were public
 * and while the trailing EPS is not a profit.
 */
export function priceToEarnings(
  market: Market,
  bars: readonly Candle[],
  statements: readonly QuarterStatement[]
): { date: string; pe: number }[] {
  const metrics = statementMetrics(statements);

  return bars.flatMap((bar) => {
    const date = candleDate(market, bar.time);

    const eps = metrics.findLast(
      ({ statement }) => statement.knownFrom <= date
    )?.trailingEps;

    return eps === null || eps === undefined || eps <= 0
      ? []
      : [{ date, pe: bar.close / eps }];
  });
}
