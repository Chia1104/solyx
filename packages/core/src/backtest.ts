import { maxBy, minBy } from "es-toolkit";
import * as z from "zod";

import type {
  BacktestColumns,
  BacktestRun,
  KernelCondition,
  KernelMetrics,
} from "@solyx/kernel/native";
import { epochDayDate } from "@solyx/utils/date";

import { adjustedCandles, adjustmentFactors, candleDays } from "./candles.ts";
import type { Candle } from "./candles.ts";
import { bollinger, ema, kd, macd, rsi, sma } from "./indicators.ts";
import type { IndicatorLine } from "./indicators.ts";
import { Market } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import { tickSize } from "./risk.ts";
import {
  TW_COMMISSION_RATE,
  TW_MIN_COMMISSION,
  twSellTaxRate,
} from "./rules/tw.ts";

const period = z.number().int().min(1).max(500);

/** A line a rule reads at each bar: one of the bar's own figures, a constant, or an indicator over the bars up to it. */
export const ruleSeriesSchema = z.union([
  z.object({ price: z.enum(["open", "high", "low", "close", "volume"]) }),
  z.object({ value: z.number() }),
  z.object({ sma: period }),
  z.object({ ema: period }),
  z.object({ rsi: period }),
  z.object({
    bollinger: period,
    band: z.enum(["upper", "middle", "lower"]),
    width: z.number().min(0.5).max(5).multipleOf(0.1).optional(),
  }),
  z.object({ macd: z.enum(["macd", "signal", "histogram"]) }),
  z.object({ kd: z.enum(["k", "d"]) }),
  z.object({
    highest: period.describe("The highest high of the bars before this one"),
  }),
  z.object({
    lowest: period.describe("The lowest low of the bars before this one"),
  }),
]);

export type RuleSeries = z.infer<typeof ruleSeriesSchema>;

/** Names a series as the engine works its line out once. */
const seriesKey = (series: RuleSeries) => JSON.stringify(series);

// A backtest's lines are worked out on the caller's thread, the backend's for an agent's script,
// and its rules read at every bar, so a strategy's work, reading it included, is bounded before it
// runs: depth and width together cap a rule at MAX_RULE_BRANCHES ** MAX_RULE_DEPTH comparisons
// read before any other limit is checked.

/** How many `all` and `any` a condition may nest. */
export const MAX_RULE_DEPTH = 3;

/** How many conditions one `all` or `any` may hold. */
export const MAX_RULE_BRANCHES = 8;

/** How many comparisons a strategy's entry and exit may make between them. */
export const MAX_RULE_COMPARISONS = 64;

/** How many different series a strategy's entry and exit may read between them. */
export const MAX_RULE_SERIES = 32;

const pair = z.tuple([ruleSeriesSchema, ruleSeriesSchema]);

/** Whether a rule holds at a bar's close, read from that bar and the ones before it alone. */
export type RuleCondition =
  | { above: [RuleSeries, RuleSeries] }
  | { below: [RuleSeries, RuleSeries] }
  | { crossesAbove: [RuleSeries, RuleSeries] }
  | { crossesBelow: [RuleSeries, RuleSeries] }
  | { all: RuleCondition[] }
  | { any: RuleCondition[] };

const conditionError = {
  error: `A condition is one of above, below, crossesAbove, crossesBelow, all and any; all and any hold 1 to ${MAX_RULE_BRANCHES} conditions and nest ${MAX_RULE_DEPTH} deep at most`,
};

const comparisonSchema = z.union(
  [
    z.object({ above: pair }),
    z.object({ below: pair }),
    z.object({ crossesAbove: pair }),
    z.object({ crossesBelow: pair }),
  ],
  conditionError
);

/**
 * A condition nesting at most `depth` more `all` and `any`, one schema per level, so a deeper tree
 * stops matching where it passes the limit rather than being read whole first.
 */
function conditionSchema(depth: number): z.ZodType<RuleCondition> {
  if (depth === 0) return comparisonSchema;

  const branches = z
    .array(conditionSchema(depth - 1))
    .min(1)
    .max(MAX_RULE_BRANCHES);

  return z.union(
    [
      comparisonSchema,
      z.object({ all: branches }),
      z.object({ any: branches }),
    ],
    conditionError
  );
}

export const ruleConditionSchema = conditionSchema(MAX_RULE_DEPTH);

/** Every series a condition's comparisons read. */
function ruleSeries(condition: RuleCondition): RuleSeries[] {
  if ("all" in condition) return condition.all.flatMap(ruleSeries);

  if ("any" in condition) return condition.any.flatMap(ruleSeries);

  if ("above" in condition) return condition.above;

  if ("below" in condition) return condition.below;

  if ("crossesAbove" in condition) return condition.crossesAbove;

  return condition.crossesBelow;
}

/** A long-only strategy: when to buy while holding nothing, and when to sell all of it. */
export const ruleStrategySchema = z
  .object({
    entry: ruleConditionSchema,
    exit: ruleConditionSchema,
    /** Sells once a close falls this fraction below the price paid. */
    stopLoss: z.number().positive().max(1).optional(),
    /** Sells once a close rises this fraction above the price paid. */
    takeProfit: z.number().positive().optional(),
  })
  .superRefine(({ entry, exit }, context) => {
    const series = [...ruleSeries(entry), ...ruleSeries(exit)];
    const comparisons = series.length / 2;

    if (comparisons > MAX_RULE_COMPARISONS) {
      context.addIssue({
        code: "custom",
        message: `A strategy makes ${MAX_RULE_COMPARISONS} comparisons at most between its entry and exit, and this makes ${comparisons}`,
      });
    }

    const distinct = new Set(series.map(seriesKey)).size;

    if (distinct > MAX_RULE_SERIES) {
      context.addIssue({
        code: "custom",
        message: `A strategy reads ${MAX_RULE_SERIES} different series at most between its entry and exit, and this reads ${distinct}`,
      });
    }
  });

export type RuleStrategy = z.infer<typeof ruleStrategySchema>;

/** What a trade costs, each a fraction of its value but the minimum commission and the slippage. */
export const tradeCostsSchema = z.object({
  commissionRate: z.number().min(0).max(0.01),
  /** In the market's currency. */
  minCommission: z.number().min(0),
  /** Paid on sales alone, as Taiwan's securities transaction tax is. */
  sellTaxRate: z.number().min(0).max(0.01),
  /** Ticks the fill gives away from the open: above it to buy, below it to sell. */
  slippageTicks: z.number().int().min(0).max(20),
});

export type TradeCosts = z.infer<typeof tradeCostsSchema>;

/** What a trade in `symbol` costs where nobody says otherwise: a Taiwan broker's full commission and the tax, a tick of slippage. */
export function defaultCosts({ market, symbol }: SymbolRef): TradeCosts {
  return market === Market.TW
    ? {
        commissionRate: TW_COMMISSION_RATE,
        minCommission: TW_MIN_COMMISSION,
        sellTaxRate: twSellTaxRate(symbol),
        slippageTicks: 1,
      }
    : { commissionRate: 0, minCommission: 0, sellTaxRate: 0, slippageTicks: 1 };
}

export interface BacktestTrade {
  /** Exchange-local days of the fills. */
  entryDate: string;
  entryPrice: number;
  /** `null` while the position is still held at the last bar. */
  exitDate: string | null;
  /** The last close for a position still held. */
  exitPrice: number;
  /** The shares bought; a split or what went ex while held changes how many are sold. */
  shares: number;
  /** What it gained after every cost, a loss below zero; marked at the last close while held. */
  profit: number;
  /** That gain as a fraction of what the shares and the commission cost. */
  return: number;
  /** Bars from the fill that bought to the one that sold, or to the last. */
  bars: number;
}

/** How a stretch of the run went. */
export interface BacktestMetrics {
  /** Exchange-local days of its first and last bars. */
  from: string;
  to: string;
  totalReturn: number;
  /** The return a year at that pace, `null` over a stretch shorter than a month. */
  annualReturn: number | null;
  /** The deepest fall of the account's value from a high before it, as a fraction. */
  maxDrawdown: number;
  /** Trades closed within it; one still held is not counted. */
  trades: number;
  winRate: number | null;
  /** The average gain over the size of the average loss; `null` without both. */
  payoffRatio: number | null;
  /** The part of its bars a position was held through. */
  exposure: number;
  /**
   * What holding the listing through it would have returned, from the close its return is measured
   * from to its last, before costs, with what went ex bought back in as the rules' prices have it.
   */
  buyAndHold: number;
  /** The deepest fall holding it would have taken from a high before it, as a fraction, on the closes `buyAndHold` reads. */
  buyAndHoldDrawdown: number;
}

export interface BacktestResult {
  capital: number;
  costs: TradeCosts;
  trades: BacktestTrade[];
  /** The account's value at each bar's close. */
  equity: { date: string; value: number }[];
  all: BacktestMetrics;
  /** Before `split`, the stretch a strategy may be fitted on; `null` without a split. */
  inSample: BacktestMetrics | null;
  /** From `split` on, the stretch that says whether it holds; `null` without a split. */
  outOfSample: BacktestMetrics | null;
}

export interface BacktestOptions {
  /** @default 1_000_000 in the market's currency */
  capital?: number;
  costs?: Partial<TradeCosts>;
  /** The exchange-local day the out-of-sample stretch starts. */
  split?: string;
}

/**
 * A line of `series`, `null` where it has nothing yet, each value read from its bar and those
 * before on that bar's own terms: a bar's own figures as traded, and an indicator over the bars
 * adjusted for splits and what went ex, carried to the terms of the bar it is read at.
 */
function seriesLine(
  series: RuleSeries,
  bars: readonly Candle[],
  adjusted: readonly Candle[],
  factors: readonly number[]
): IndicatorLine {
  if ("price" in series) return bars.map((bar) => bar[series.price]);

  if ("value" in series) return bars.map(() => series.value);

  const closes = adjusted.map((bar) => bar.close);

  // Oscillators read alike on any terms.
  if ("rsi" in series) return rsi(closes, series.rsi);

  if ("kd" in series) return kd(adjusted)[series.kd];

  const priced = (line: IndicatorLine) =>
    line.map((value, index) =>
      value === null ? null : value * factors[index]
    );

  if ("sma" in series) return priced(sma(closes, series.sma));

  if ("ema" in series) return priced(ema(closes, series.ema));

  if ("bollinger" in series) {
    return priced(
      bollinger(closes, series.bollinger, series.width)[series.band]
    );
  }

  if ("macd" in series) return priced(macd(closes)[series.macd]);

  const span = "highest" in series ? series.highest : series.lowest;

  return priced(
    adjusted.map((_, index) => {
      if (index < span) return null;

      const before = adjusted.slice(index - span, index);

      return "highest" in series
        ? (maxBy(before, (bar) => bar.high)?.high ?? null)
        : (minBy(before, (bar) => bar.low)?.low ?? null);
    })
  );
}

/** The lines a strategy's rules read, each series once, and its rules naming them by their place. */
function kernelRules(
  strategy: RuleStrategy,
  bars: readonly Candle[],
  adjusted: readonly Candle[],
  factors: readonly number[]
) {
  const places = new Map<string, number>();
  const lines: Float64Array[] = [];

  const place = (series: RuleSeries) => {
    const key = seriesKey(series);
    const known = places.get(key);

    if (known !== undefined) return known;

    places.set(key, lines.length);
    lines.push(
      Float64Array.from(
        seriesLine(series, bars, adjusted, factors),
        (value) => value ?? Number.NaN
      )
    );

    return lines.length - 1;
  };

  const rule = (condition: RuleCondition): KernelCondition => {
    if ("all" in condition) return { all: condition.all.map(rule) };

    if ("any" in condition) return { any: condition.any.map(rule) };

    if ("above" in condition) return { above: condition.above.map(place) };

    if ("below" in condition) return { below: condition.below.map(place) };

    if ("crossesAbove" in condition) {
      return { crossesAbove: condition.crossesAbove.map(place) };
    }

    return { crossesBelow: condition.crossesBelow.map(place) };
  };

  return { entry: rule(strategy.entry), exit: rule(strategy.exit), lines };
}

/** Runs a backtest's columns, here or on the process that holds the kernel. */
export interface BacktestKernel {
  backtest(columns: BacktestColumns): BacktestRun | Promise<BacktestRun>;
}

/**
 * Runs a long-only strategy over a listing's bars, oldest first, on `kernel`. Each rule is read at a
 * bar's close from that bar and the ones before it, and acted on at the next bar's open, so no
 * decision sees a price it could not have. A buy spends what the account holds on whole shares; a
 * sale sells them all. A Taiwan bar that opened and closed at one price, up from its reference, is
 * read as locked at its limit and fills no buy, and one locked down fills no sale.
 *
 * Indicators, stops and buying and holding read prices adjusted from the bars' references, so a
 * split or what went ex reads as no move, each bar's on its own terms so no later one changes it,
 * while orders fill at prices as traded. A holding carries over a split or what went ex at the
 * session's reference, as though what went ex bought more shares then, which is what those prices
 * assume.
 */
export async function backtest(
  kernel: BacktestKernel,
  symbol: SymbolRef,
  bars: readonly Candle[],
  strategy: RuleStrategy,
  options: BacktestOptions = {}
): Promise<BacktestResult> {
  if (bars.length < 2) throw new Error("A backtest needs two bars at least");

  const capital = options.capital ?? 1_000_000;
  const costs = { ...defaultCosts(symbol), ...options.costs };
  const adjusted = adjustedCandles(bars);
  const factors = adjustmentFactors(bars);
  const days = candleDays(symbol.market, bars);
  const dates = Array.from(days, epochDayDate);
  const last = bars.length - 1;

  const slipped = (price: number, up: boolean) => {
    const tick = tickSize(symbol, price);
    const moved = price + (up ? 1 : -1) * tick * costs.slippageTicks;

    return Math.max(moved, tick);
  };

  // No order fills on the first bar, so it is never read as locked.
  const locked = (index: number, up: boolean) => {
    if (index === 0) return 0;

    const bar = bars[index];
    const reference = bar.reference ?? bars[index - 1].close;

    return symbol.market === Market.TW &&
      bar.high === bar.low &&
      (up ? bar.close > reference : bar.close < reference)
      ? 1
      : 0;
  };

  const { split: splitDay } = options;

  const splitAt =
    splitDay === undefined ? -1 : dates.findIndex((date) => date >= splitDay);

  const split = splitAt > 0 && splitAt <= last;

  const run = await kernel.backtest({
    close: Float64Array.from(bars, (bar) => bar.close),
    adjustedClose: Float64Array.from(adjusted, (bar) => bar.close),
    factor: Float64Array.from(factors),
    carry: Float64Array.from(bars, (bar, index) =>
      index > 0 && bar.reference !== undefined
        ? bars[index - 1].close / bar.reference
        : 1
    ),
    buyPrice: Float64Array.from(bars, (bar) => slipped(bar.open, true)),
    sellPrice: Float64Array.from(bars, (bar) => slipped(bar.open, false)),
    buyLocked: Uint8Array.from(bars, (_, index) => locked(index, true)),
    sellLocked: Uint8Array.from(bars, (_, index) => locked(index, false)),
    day: days,
    ...kernelRules(strategy, bars, adjusted, factors),
    stopLoss: strategy.stopLoss,
    takeProfit: strategy.takeProfit,
    capital,
    commissionRate: costs.commissionRate,
    minCommission: costs.minCommission,
    sellTaxRate: costs.sellTaxRate,
    splitAt: split ? splitAt : undefined,
  });

  const stretch = (
    first: number,
    end: number,
    metrics: KernelMetrics
  ): BacktestMetrics => ({ from: dates[first], to: dates[end], ...metrics });

  const { trades } = run;

  return {
    capital,
    costs,
    trades: Array.from(trades.entry, (entry, index) => {
      const exit = trades.exit[index];

      return {
        entryDate: dates[entry],
        entryPrice: trades.entryPrice[index],
        exitDate: exit === -1 ? null : dates[exit],
        exitPrice: trades.exitPrice[index],
        shares: trades.shares[index],
        profit: trades.profit[index],
        return: trades.return[index],
        bars: (exit === -1 ? last : exit) - entry,
      };
    }),
    equity: Array.from(run.equity, (value, index) => ({
      date: dates[index],
      value,
    })),
    all: stretch(0, last, run.all),
    inSample:
      split && run.inSample ? stretch(0, splitAt - 1, run.inSample) : null,
    outOfSample:
      split && run.outOfSample ? stretch(splitAt, last, run.outOfSample) : null,
  };
}
