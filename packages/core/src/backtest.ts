import * as z from "zod";

import type {
  BacktestRequest,
  BacktestRun,
  KernelBars,
  KernelCondition,
  KernelMetrics,
  KernelStrategy,
  KernelStretches,
  ScanRequest,
  ScanRun,
  WalkForwardRequest,
  WalkForwardRun,
} from "@solyx/kernel/native";
import { dateEpochDay, epochDayDate } from "@solyx/utils/date";

import {
  Interval,
  adjustedCandles,
  adjustmentFactors,
  barTime,
  candleDays,
  isIntraday,
  withSessionMoves,
} from "./candles.ts";
import type { Candle } from "./candles.ts";
import { bollinger, ema, kd, macd, rsi, sma } from "./indicators.ts";
import type { IndicatorLine } from "./indicators.ts";
import { Market, symbolLabel } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import { tickSize } from "./risk.ts";
import {
  TW_COMMISSION_RATE,
  TW_MIN_COMMISSION,
  twPriceLimits,
  twSellTaxRate,
} from "./rules/tw.ts";

const period = z.number().int().min(1).max(500);

// Every shape a strategy is written in refuses a key it does not know, so a misspelt one, such as a
// stop, fails the backtest rather than leaving it out.

/** A line a rule reads at each bar: one of the bar's own figures, a constant, or an indicator over the bars up to it. */
export const ruleSeriesSchema = z.union([
  z.strictObject({ price: z.enum(["open", "high", "low", "close", "volume"]) }),
  z.strictObject({ value: z.number() }),
  z.strictObject({ sma: period }),
  z.strictObject({ ema: period }),
  z.strictObject({ rsi: period }),
  z.strictObject({
    bollinger: period,
    band: z.enum(["upper", "middle", "lower"]),
    width: z.number().min(0.5).max(5).multipleOf(0.1).optional(),
  }),
  z.strictObject({ macd: z.enum(["macd", "signal", "histogram"]) }),
  z.strictObject({ kd: z.enum(["k", "d"]) }),
  z.strictObject({
    highest: period.describe("The highest high of the bars before this one"),
  }),
  z.strictObject({
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
    z.strictObject({ above: pair }),
    z.strictObject({ below: pair }),
    z.strictObject({ crossesAbove: pair }),
    z.strictObject({ crossesBelow: pair }),
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
      z.strictObject({ all: branches }),
      z.strictObject({ any: branches }),
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
  .strictObject({
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
export const tradeCostsSchema = z.strictObject({
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
  /** When the fill that bought was, on the exchange's clock: the session's day on daily and longer bars, the minute on shorter ones. */
  entryTime: string;
  entryPrice: number;
  /** When the fill that sold was; `null` while the position is still held at the last bar. */
  exitTime: string | null;
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

/** How a stretch of the run went, dated by its first and last sessions. */
export interface BacktestMetrics extends KernelMetrics {
  /** Exchange-local days of its first and last bars. */
  from: string;
  to: string;
}

export interface BacktestResult {
  interval: Interval;
  /** How many bars it ran over. */
  bars: number;
  capital: number;
  costs: TradeCosts;
  trades: BacktestTrade[];
  /** The account's value at each session's close. */
  equity: { date: string; value: number }[];
  all: BacktestMetrics;
  /** Before `split`, the stretch a strategy may be fitted on; `null` without a split. */
  inSample: BacktestMetrics | null;
  /** From `split` on, the stretch that says whether it holds; `null` without a split. */
  outOfSample: BacktestMetrics | null;
}

/** A strategy's figures over all the bars, and before and from the split where there is one. */
export interface BacktestStretches {
  all: BacktestMetrics;
  inSample: BacktestMetrics | null;
  outOfSample: BacktestMetrics | null;
}

/** Strategies run each on its own over one listing's bars. */
export interface BacktestScan {
  interval: Interval;
  bars: number;
  /** Each strategy's figures, in the order they came; none tests its timing. */
  cells: BacktestStretches[];
  /**
   * Where the strategies make a grid, row by row, the cell whose neighbourhood, it and the cells
   * beside it, had the highest mean Sharpe ratio, in-sample where there is a split, so a cell that
   * did well alone among neighbours that did not is not picked; `edge` says it lies on the grid's
   * border, past which the best may lie. `null` without a grid or a cell with a Sharpe ratio.
   */
  plateau: { cell: number; sharpe: number; edge: boolean } | null;
}

/** A window of a walk forward: the sessions it trained and tested on, and the strategy it picked. */
export interface WalkForwardWindow {
  train: { from: string; to: string };
  test: { from: string; to: string };
  /** `null` where no strategy had a Sharpe ratio over the training, and the test then held nothing. */
  cell: number | null;
  /** The pick's own Sharpe ratio over its training, not its neighbourhood's. */
  trainSharpe: number | null;
}

/**
 * Strategies picked on each window's sessions and run on the sessions after, those tests run as one
 * with the holding carried from one to the next, so the record is of picking on the past alone.
 */
export interface WalkForwardResult {
  interval: Interval;
  bars: number;
  windows: WalkForwardWindow[];
  outOfSample: BacktestMetrics;
  /** The out-of-sample Sharpe ratio over the mean of the picks' training ones; well under 1 says the picks were fitted. */
  efficiency: number | null;
  /** The account's value at each session's close from the first test on. */
  equity: { date: string; value: number }[];
}

/**
 * Where the out-of-sample stretch starts: on an exchange-local day, or after a share of the
 * sessions, as 2/3 starts it about two thirds of the way through them.
 */
export type BacktestSplit = { day: string } | { share: number };

export interface BacktestOptions {
  /** @default 1_000_000 in the market's currency */
  capital?: number;
  costs?: Partial<TradeCosts>;
  split?: BacktestSplit;
  /** @default Interval.OneDay */
  interval?: Interval;
  /**
   * The listing's daily bars over the same sessions, for bars shorter than a day: each session's
   * reference, its limits and what went ex or split at it come from them.
   */
  daily?: readonly Candle[];
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

  return priced(
    "highest" in series
      ? extremeBefore(
          adjusted.map((bar) => bar.high),
          series.highest,
          (kept, joining) => kept > joining
        )
      : extremeBefore(
          adjusted.map((bar) => bar.low),
          series.lowest,
          (kept, joining) => kept < joining
        )
  );
}

/**
 * The value of the `span` bars before each one that `beats` every other, `null` until there are
 * that many, in one pass over a window of the bars no later one in it beats.
 */
function extremeBefore(
  values: readonly number[],
  span: number,
  beats: (kept: number, joining: number) => boolean
): IndicatorLine {
  const kept: number[] = [];
  let first = 0;

  return values.map((_, index) => {
    if (index > 0) {
      const joining = values[index - 1];

      while (
        kept.length > first &&
        !beats(values[kept[kept.length - 1]], joining)
      ) {
        kept.pop();
      }

      kept.push(index - 1);
    }

    while (kept[first] < index - span) first++;

    return index < span ? null : values[kept[first]];
  });
}

/** The lines strategies' rules read, each series once among them all, and their rules naming them by their place. */
function kernelStrategies(
  strategies: readonly RuleStrategy[],
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

    const line = seriesLine(series, bars, adjusted, factors);
    const column = new Float64Array(line.length);

    for (let index = 0; index < line.length; index++) {
      column[index] = line[index] ?? Number.NaN;
    }

    places.set(key, lines.length);
    lines.push(column);

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

  const ruled = strategies.map((strategy): KernelStrategy => ({
    entry: rule(strategy.entry),
    exit: rule(strategy.exit),
    stopLoss: strategy.stopLoss,
    takeProfit: strategy.takeProfit,
  }));

  if (lines.length > MAX_SCAN_SERIES) {
    throw new Error(
      `Strategies read ${MAX_SCAN_SERIES} different series at most between them, and these read ${lines.length}`
    );
  }

  return { lines, strategies: ruled };
}

/** Runs backtests' columns, here or on the process that holds the kernel. */
export interface BacktestKernel {
  backtest(request: BacktestRequest): BacktestRun | Promise<BacktestRun>;
  scan(request: ScanRequest): ScanRun | Promise<ScanRun>;
  walkForward(
    request: WalkForwardRequest
  ): WalkForwardRun | Promise<WalkForwardRun>;
}

/** How many orderings of each stretch's bars a backtest's timing is tested against. */
export const BACKTEST_PERMUTATIONS = 1000;

/** The most strategies a scan or a walk forward runs. */
export const MAX_SCAN_STRATEGIES = 400;

/** The most different series a scan's or a walk forward's strategies read between them. */
export const MAX_SCAN_SERIES = 64;

/** The most bars a backtest runs over: a session's minute bars over the furthest back it may read, with room. */
export const BACKTEST_BARS = 300_000;

/** How many different series `strategies` read between them, which a scan holds to `MAX_SCAN_SERIES`. */
export const distinctSeries = (strategies: readonly RuleStrategy[]) =>
  new Set(
    strategies.flatMap((strategy) =>
      [...ruleSeries(strategy.entry), ...ruleSeries(strategy.exit)].map(
        seriesKey
      )
    )
  ).size;

/** Where a backtest reads a listing's bars: the app's own history, or from a day on. */
export interface BacktestBarsSource {
  candles(symbol: SymbolRef, interval: Interval): Promise<Candle[]>;
  /** From `since`, `YYYY-MM-DD` on the exchange's calendar, on. */
  candlesSince(
    symbol: SymbolRef,
    interval: Interval,
    since: string
  ): Promise<Candle[]>;
}

/**
 * A listing's `interval` bars as a backtest reads them, over the app's own history or from `since`
 * on, and where they are shorter than a day its daily bars over the same reach, which their
 * sessions' references come from.
 */
export async function backtestBars(
  source: BacktestBarsSource,
  symbol: SymbolRef,
  interval: Interval,
  since?: string
) {
  const read = (each: Interval) =>
    since === undefined
      ? source.candles(symbol, each)
      : source.candlesSince(symbol, each, since);

  const bars = await read(interval);

  if (bars.length < 2) {
    throw new Error(
      `${symbolLabel(symbol)} has too few ${interval} bars to backtest`
    );
  }

  if (bars.length > BACKTEST_BARS) {
    throw new Error(
      `${bars.length} ${interval} bars are more than a backtest takes (${BACKTEST_BARS}); start later or take a longer interval`
    );
  }

  return {
    bars,
    daily: isIntraday(interval) ? await read(Interval.OneDay) : undefined,
  };
}

// A price read as at a limit within this of it, so a limit rebuilt from ticks matches the bar's.
const PRICE_TOLERANCE = 1e-6;

/** Each session's reference by its day, from its daily bar: the exchange's where it has one, else the close before. */
function sessionReferences(market: Market, daily: readonly Candle[]) {
  const days = candleDays(market, daily);
  const references = new Map<number, number>();

  daily.forEach((bar, index) => {
    const reference = bar.reference ?? daily[index - 1]?.close;

    if (reference !== undefined) references.set(days[index], reference);
  });

  return references;
}

/** Where a daily bar is locked at its limit: it traded at one price, away from its reference. */
function dailyLocks(bars: readonly Candle[]) {
  const up = new Uint8Array(bars.length);
  const down = new Uint8Array(bars.length);

  for (let index = 1; index < bars.length; index++) {
    const bar = bars[index];
    const reference = bar.reference ?? bars[index - 1].close;

    if (bar.high !== bar.low) continue;

    up[index] = Number(bar.close > reference);
    down[index] = Number(bar.close < reference);
  }

  return { up, down };
}

/** Where a shorter bar is locked at its limit: it traded at one price, its session's limit. */
function intradayLocks(
  symbol: SymbolRef,
  bars: readonly Candle[],
  days: Int32Array,
  daily: readonly Candle[]
) {
  const up = new Uint8Array(bars.length);
  const down = new Uint8Array(bars.length);
  const references = sessionReferences(symbol.market, daily);

  const limitsOf = (index: number) => {
    const reference = references.get(days[index]) ?? bars[index - 1]?.close;

    return reference === undefined
      ? undefined
      : twPriceLimits(reference, symbol.symbol);
  };

  let limits = limitsOf(0);

  for (let index = 1; index < bars.length; index++) {
    const bar = bars[index];

    if (days[index] !== days[index - 1]) limits = limitsOf(index);

    if (!limits || bar.high !== bar.low) continue;

    up[index] = Number(bar.close > limits.high - PRICE_TOLERANCE);
    down[index] = Number(bar.close < limits.low + PRICE_TOLERANCE);
  }

  return { up, down };
}

/**
 * Where a bar is locked at its limit and fills nothing on that side, the first bar never: only
 * Taiwan's listings have limits, and bars shorter than a day read theirs from `daily`.
 */
function limitLocks(
  symbol: SymbolRef,
  bars: readonly Candle[],
  days: Int32Array,
  daily: readonly Candle[] | undefined
) {
  if (symbol.market !== Market.TW) {
    return {
      up: new Uint8Array(bars.length),
      down: new Uint8Array(bars.length),
    };
  }

  return daily ? intradayLocks(symbol, bars, days, daily) : dailyLocks(bars);
}

/**
 * What the kernel reads of each bar's prices: its open and close as traded and adjusted, what a
 * holding's shares are carried over by at it, and what a buy and a sale fill at on its open.
 */
function priceColumns(
  symbol: SymbolRef,
  bars: readonly Candle[],
  adjusted: readonly Candle[],
  slippageTicks: number
) {
  const slipped = (price: number, up: boolean) => {
    const tick = tickSize(symbol, price);
    const moved = price + (up ? 1 : -1) * tick * slippageTicks;

    return Math.max(moved, tick);
  };

  const open = new Float64Array(bars.length);
  const close = new Float64Array(bars.length);
  const adjustedOpen = new Float64Array(bars.length);
  const adjustedClose = new Float64Array(bars.length);
  const carry = new Float64Array(bars.length);
  const buyPrice = new Float64Array(bars.length);
  const sellPrice = new Float64Array(bars.length);

  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    const { reference } = bar;

    open[index] = bar.open;
    close[index] = bar.close;
    adjustedOpen[index] = adjusted[index].open;
    adjustedClose[index] = adjusted[index].close;
    carry[index] =
      index > 0 && reference !== undefined
        ? bars[index - 1].close / reference
        : 1;
    buyPrice[index] = slipped(bar.open, true);
    sellPrice[index] = slipped(bar.open, false);
  }

  return {
    open,
    close,
    adjustedOpen,
    adjustedClose,
    carry,
    buyPrice,
    sellPrice,
  };
}

/** The account's value at each session's close, from `equity`, which starts at bar `first`. */
function sessionEquity(
  days: Int32Array,
  equity: Float64Array,
  first: number
): { date: string; value: number }[] {
  const closes: { date: string; value: number }[] = [];

  for (let index = first; index < days.length; index++) {
    if (index === days.length - 1 || days[index + 1] !== days[index]) {
      closes.push({
        date: epochDayDate(days[index]),
        value: equity[index - first],
      });
    }
  }

  return closes;
}

/** The kernel's trades, each timed by its bars as the exchange's clock reads them. */
function timedTrades(
  {
    entry,
    exit,
    entryPrice,
    exitPrice,
    shares,
    profit,
    return: gain,
  }: BacktestRun["trades"],
  time: (index: number) => string,
  last: number
): BacktestTrade[] {
  return Array.from(entry, (bought, index) => {
    const sold = exit[index];

    return {
      entryTime: time(bought),
      entryPrice: entryPrice[index],
      exitTime: sold === -1 ? null : time(sold),
      exitPrice: exitPrice[index],
      shares: shares[index],
      profit: profit[index],
      return: gain[index],
      bars: (sold === -1 ? last : sold) - bought,
    };
  });
}

/** The first bar of the out-of-sample stretch `split` starts; -1 where no bar is past it. */
function splitIndex(days: Int32Array, split: BacktestSplit) {
  if ("day" in split) {
    const day = dateEpochDay(split.day);

    return days.findIndex((each) => each >= day);
  }

  const sessions: number[] = [];

  days.forEach((day, index) => {
    if (index === 0 || day !== days[index - 1]) sessions.push(index);
  });

  return sessions[Math.floor(sessions.length * split.share)] ?? -1;
}

/**
 * A listing's bars as the kernel reads them, every strategy's lines among them, and what its
 * answers are read back with: each bar's session, the split and the stretches dated by them.
 * Bars shorter than a day take their sessions' references from `options.daily`.
 */
function prepare(
  symbol: SymbolRef,
  candles: readonly Candle[],
  strategies: readonly RuleStrategy[],
  options: BacktestOptions
) {
  if (candles.length < 2) {
    throw new Error("A backtest needs two bars at least");
  }

  const interval = options.interval ?? Interval.OneDay;
  const daily = isIntraday(interval) ? (options.daily ?? []) : undefined;

  const bars = daily
    ? withSessionMoves(symbol.market, candles, daily)
    : candles;

  const capital = options.capital ?? 1_000_000;
  const costs = { ...defaultCosts(symbol), ...options.costs };
  const adjusted = adjustedCandles(bars);
  const factors = adjustmentFactors(bars);
  const days = candleDays(symbol.market, bars);
  const locks = limitLocks(symbol, bars, days, daily);
  const last = bars.length - 1;
  const rules = kernelStrategies(strategies, bars, adjusted, factors);

  const splitAt = options.split ? splitIndex(days, options.split) : -1;

  const kernelBars: KernelBars = {
    ...priceColumns(symbol, bars, adjusted, costs.slippageTicks),
    factor: Float64Array.from(factors),
    buyLocked: locks.up,
    sellLocked: locks.down,
    day: days,
    lines: rules.lines,
    capital,
    commissionRate: costs.commissionRate,
    minCommission: costs.minCommission,
    sellTaxRate: costs.sellTaxRate,
  };

  const date = (index: number) => epochDayDate(days[index]);

  const stretch = (
    first: number,
    end: number,
    metrics: KernelMetrics
  ): BacktestMetrics => ({ from: date(first), to: date(end), ...metrics });

  return {
    interval,
    bars,
    days,
    capital,
    costs,
    last,
    kernelBars,
    strategies: rules.strategies,
    splitAt: splitAt > 0 && splitAt <= last ? splitAt : undefined,
    date,
    stretch,

    /** A run's stretches, dated. */
    stretches({ all, inSample, outOfSample }: KernelStretches) {
      const at = this.splitAt;

      return {
        all: stretch(0, last, all),
        inSample: at && inSample ? stretch(0, at - 1, inSample) : null,
        outOfSample: at && outOfSample ? stretch(at, last, outOfSample) : null,
      };
    },
  };
}

/**
 * Runs a long-only strategy over a listing's bars, oldest first, on `kernel`. Each rule is read at a
 * bar's close from that bar and the ones before it, and acted on at the next bar's open, so no
 * decision sees a price it could not have; a session's first bar fills after the gap from the close
 * before. A buy spends what the account holds on whole shares; a sale sells them all. A Taiwan bar
 * locked at its limit fills nothing on that side: a daily one that traded at one price away from its
 * reference, a shorter one that traded at one price, its session's limit. Each stretch's timing is
 * tested against `BACKTEST_PERMUTATIONS` orderings of its bars.
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
  candles: readonly Candle[],
  strategy: RuleStrategy,
  options: BacktestOptions = {}
): Promise<BacktestResult> {
  const prepared = prepare(symbol, candles, [strategy], options);
  const { bars, days, last, interval } = prepared;

  const run = await kernel.backtest({
    bars: prepared.kernelBars,
    strategy: prepared.strategies[0],
    splitAt: prepared.splitAt,
    permutations: BACKTEST_PERMUTATIONS,
  });

  return {
    interval,
    bars: bars.length,
    capital: prepared.capital,
    costs: prepared.costs,
    trades: timedTrades(
      run.trades,
      (index) => barTime(symbol.market, interval, bars[index].time),
      last
    ),
    equity: sessionEquity(days, run.equity, 0),
    ...prepared.stretches(run.stretches),
  };
}

export interface ScanOptions extends BacktestOptions {
  /** How many strategies a row of the grid they make holds, row by row. */
  columns?: number;
}

/**
 * Runs each of `strategies` on its own over a listing's bars as `backtest` runs one, all at once and
 * with no timing tested, and where they make a grid picks the plateau of its Sharpe ratios.
 */
export async function scanBacktests(
  kernel: BacktestKernel,
  symbol: SymbolRef,
  candles: readonly Candle[],
  strategies: readonly RuleStrategy[],
  options: ScanOptions = {}
): Promise<BacktestScan> {
  const prepared = prepare(symbol, candles, strategies, options);

  const run = await kernel.scan({
    bars: prepared.kernelBars,
    strategies: prepared.strategies,
    splitAt: prepared.splitAt,
    columns: options.columns,
  });

  return {
    interval: prepared.interval,
    bars: prepared.bars.length,
    cells: run.cells.map((cell) => prepared.stretches(cell)),
    plateau: run.plateau,
  };
}

export interface WalkForwardOptions extends Omit<BacktestOptions, "split"> {
  /** How many strategies a row of the grid they make holds, row by row. */
  columns?: number;
  /** Sessions each window trains on; @default two fifths of the sessions */
  train?: number;
  /** Sessions each window then tests on, and moves on by; @default a quarter of `train` */
  test?: number;
}

/**
 * Picks one of `strategies` on each window's training, by the plateau of their Sharpe ratios where
 * they make a grid and else the best, runs it over the sessions that follow, and runs those tests as
 * one, so what the picks did out of sample is measured, its timing tested as `backtest` tests one.
 */
export async function walkForward(
  kernel: BacktestKernel,
  symbol: SymbolRef,
  candles: readonly Candle[],
  strategies: readonly RuleStrategy[],
  options: WalkForwardOptions = {}
): Promise<WalkForwardResult> {
  const prepared = prepare(symbol, candles, strategies, options);
  const sessions = new Set(prepared.days).size;
  const train = options.train ?? Math.floor((sessions * 2) / 5);
  const test = options.test ?? Math.max(1, Math.floor(train / 4));

  const run = await kernel.walkForward({
    bars: prepared.kernelBars,
    strategies: prepared.strategies,
    columns: options.columns,
    train,
    test,
    permutations: BACKTEST_PERMUTATIONS,
  });

  const { date, days, last } = prepared;
  const first = run.windows[0].testFirst;

  return {
    interval: prepared.interval,
    bars: prepared.bars.length,
    windows: run.windows.map((window) => ({
      train: { from: date(window.trainFirst), to: date(window.trainLast) },
      test: { from: date(window.testFirst), to: date(window.testLast) },
      cell: window.cell,
      trainSharpe: window.trainSharpe,
    })),
    outOfSample: prepared.stretch(first, last, run.outOfSample),
    efficiency: run.efficiency,
    equity: sessionEquity(days, run.equity, first),
  };
}
