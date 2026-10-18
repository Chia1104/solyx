import { maxBy, minBy, sumBy } from "es-toolkit";
import * as z from "zod";

import { adjustedCandles, adjustmentFactors, candleDate } from "./candles.ts";
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
    width: z.number().positive().max(5).optional(),
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

const pair = z.tuple([ruleSeriesSchema, ruleSeriesSchema]);

/** Whether a rule holds at a bar's close, read from that bar and the ones before it alone. */
export type RuleCondition =
  | { above: [RuleSeries, RuleSeries] }
  | { below: [RuleSeries, RuleSeries] }
  | { crossesAbove: [RuleSeries, RuleSeries] }
  | { crossesBelow: [RuleSeries, RuleSeries] }
  | { all: RuleCondition[] }
  | { any: RuleCondition[] };

export const ruleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.union([
    z.object({ above: pair }),
    z.object({ below: pair }),
    z.object({ crossesAbove: pair }),
    z.object({ crossesBelow: pair }),
    z.object({ all: z.array(ruleConditionSchema).min(1) }),
    z.object({ any: z.array(ruleConditionSchema).min(1) }),
  ])
);

/** A long-only strategy: when to buy while holding nothing, and when to sell all of it. */
export const ruleStrategySchema = z.object({
  entry: ruleConditionSchema,
  exit: ruleConditionSchema,
  /** Sells once a close falls this fraction below the price paid. */
  stopLoss: z.number().positive().max(1).optional(),
  /** Sells once a close rises this fraction above the price paid. */
  takeProfit: z.number().positive().optional(),
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

const DAYS_A_YEAR = 365.25;

// A stretch shorter than this has no yearly pace worth naming.
const SHORTEST_ANNUALIZED_DAYS = 28;

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

/** Reads each condition at a bar from lines worked out once per series. */
function conditionReader(
  bars: readonly Candle[],
  adjusted: readonly Candle[],
  factors: readonly number[]
) {
  const lines = new Map<string, IndicatorLine>();

  const line = (series: RuleSeries) => {
    const key = JSON.stringify(series);
    const known = lines.get(key);

    if (known) return known;

    const made = seriesLine(series, bars, adjusted, factors);

    lines.set(key, made);

    return made;
  };

  const compare = (
    [a, b]: [RuleSeries, RuleSeries],
    index: number,
    holds: (left: number, right: number) => boolean
  ) => {
    const left = line(a)[index];
    const right = line(b)[index];

    return left !== null && right !== null && holds(left, right);
  };

  const holds = (condition: RuleCondition, index: number): boolean => {
    if ("all" in condition) {
      return condition.all.every((each) => holds(each, index));
    }

    if ("any" in condition) {
      return condition.any.some((each) => holds(each, index));
    }

    if ("above" in condition) {
      return compare(condition.above, index, (left, right) => left > right);
    }

    if ("below" in condition) {
      return compare(condition.below, index, (left, right) => left < right);
    }

    const crossing =
      "crossesAbove" in condition
        ? condition.crossesAbove
        : condition.crossesBelow;

    const upward = "crossesAbove" in condition;

    return (
      index > 0 &&
      compare(crossing, index - 1, (left, right) =>
        upward ? left <= right : left >= right
      ) &&
      compare(crossing, index, (left, right) =>
        upward ? left > right : left < right
      )
    );
  };

  return holds;
}

/** How the bars from `first` to `last` went, against the account's value at the close before them. */
function metrics(
  symbol: SymbolRef,
  bars: readonly Candle[],
  equity: readonly number[],
  held: readonly boolean[],
  trades: readonly (BacktestTrade & { exitIndex: number | null })[],
  first: number,
  last: number,
  capital: number
): BacktestMetrics {
  const start = first === 0 ? capital : equity[first - 1];
  const end = equity[last];
  const from = candleDate(symbol.market, bars[first].time);
  const to = candleDate(symbol.market, bars[last].time);
  const totalReturn = (end - start) / start;

  const days = Temporal.PlainDate.from(from).until(
    Temporal.PlainDate.from(to)
  ).days;

  // From the close the account's value is measured from, so both start on one price; no order
  // fills on the first bar, so the first stretch's start is its first close.
  const holdFrom = bars[Math.max(first - 1, 0)].close;

  let peak = start;
  let maxDrawdown = 0;
  let holdPeak = holdFrom;
  let buyAndHoldDrawdown = 0;

  for (let index = first; index <= last; index++) {
    peak = Math.max(peak, equity[index]);
    maxDrawdown = Math.max(maxDrawdown, 1 - equity[index] / peak);
    holdPeak = Math.max(holdPeak, bars[index].close);
    buyAndHoldDrawdown = Math.max(
      buyAndHoldDrawdown,
      1 - bars[index].close / holdPeak
    );
  }

  const closed = trades.filter(
    ({ exitIndex }) =>
      exitIndex !== null && exitIndex >= first && exitIndex <= last
  );

  const wins = closed.filter((trade) => trade.profit > 0);
  const losses = closed.filter((trade) => trade.profit < 0);

  const averageWin =
    wins.length > 0 ? sumBy(wins, (trade) => trade.profit) / wins.length : null;

  const averageLoss =
    losses.length > 0
      ? sumBy(losses, (trade) => trade.profit) / losses.length
      : null;

  return {
    from,
    to,
    totalReturn,
    annualReturn:
      days < SHORTEST_ANNUALIZED_DAYS || end <= 0
        ? null
        : (end / start) ** (DAYS_A_YEAR / days) - 1,
    maxDrawdown,
    trades: closed.length,
    winRate: closed.length > 0 ? wins.length / closed.length : null,
    payoffRatio:
      averageWin !== null && averageLoss !== null
        ? averageWin / -averageLoss
        : null,
    exposure:
      held.slice(first, last + 1).filter(Boolean).length / (last - first + 1),
    buyAndHold: bars[last].close / holdFrom - 1,
    buyAndHoldDrawdown,
  };
}

/**
 * Runs a long-only strategy over a listing's bars, oldest first. Each rule is read at a bar's
 * close from that bar and the ones before it, and acted on at the next bar's open, so no decision
 * sees a price it could not have. A buy spends what the account holds on whole shares; a sale
 * sells them all. A Taiwan bar that opened and closed at one price, up from its reference, is read
 * as locked at its limit and fills no buy, and one locked down fills no sale.
 *
 * Indicators, stops and buying and holding read prices adjusted from the bars' references, so a
 * split or what went ex reads as no move, each bar's on its own terms so no later one changes it,
 * while orders fill at prices as traded. A holding carries over a split or what went ex at the
 * session's reference, as though what went ex bought more shares then, which is what those prices
 * assume.
 */
export function backtest(
  symbol: SymbolRef,
  bars: readonly Candle[],
  strategy: RuleStrategy,
  options: BacktestOptions = {}
): BacktestResult {
  if (bars.length < 2) throw new Error("A backtest needs two bars at least");

  const capital = options.capital ?? 1_000_000;
  const costs = { ...defaultCosts(symbol), ...options.costs };
  const adjusted = adjustedCandles(bars);
  const factors = adjustmentFactors(bars);
  const holds = conditionReader(bars, adjusted, factors);

  const commission = (value: number) =>
    Math.max(value * costs.commissionRate, value > 0 ? costs.minCommission : 0);

  const slipped = (price: number, up: boolean) => {
    const tick = tickSize(symbol, price);
    const moved = price + (up ? 1 : -1) * tick * costs.slippageTicks;

    return Math.max(moved, tick);
  };

  const locked = (index: number, up: boolean) => {
    const bar = bars[index];
    const reference = bar.reference ?? bars[index - 1].close;

    return (
      symbol.market === Market.TW &&
      bar.high === bar.low &&
      (up ? bar.close > reference : bar.close < reference)
    );
  };

  let cash = capital;

  let position: {
    /** Fractional once a split or what went ex has carried it over. */
    shares: number;
    bought: number;
    price: number;
    cost: number;
    index: number;
  } | null = null;

  let pending: "buy" | "sell" | null = null;
  const trades: (BacktestTrade & { exitIndex: number | null })[] = [];
  const equity: number[] = [];
  const held: boolean[] = [];

  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];

    if (position && bar.reference !== undefined) {
      position.shares *= bars[index - 1].close / bar.reference;
    }

    if (pending === "buy" && !position && !locked(index, true)) {
      const price = slipped(bar.open, true);

      // The most shares whose price and commission, at its rate or its minimum, the cash covers.
      const shares = Math.max(
        Math.min(
          Math.floor(cash / (price * (1 + costs.commissionRate))),
          Math.floor((cash - costs.minCommission) / price)
        ),
        0
      );

      const fee = commission(price * shares);

      if (shares > 0 && price * shares + fee <= cash) {
        cash -= price * shares + fee;
        position = {
          shares,
          bought: shares,
          price,
          cost: price * shares + fee,
          index,
        };
      }
    } else if (pending === "sell" && position && !locked(index, false)) {
      const price = slipped(bar.open, false);
      const value = price * position.shares;
      const proceeds = value - commission(value) - value * costs.sellTaxRate;

      cash += proceeds;
      trades.push({
        entryDate: candleDate(symbol.market, bars[position.index].time),
        entryPrice: position.price,
        exitDate: candleDate(symbol.market, bar.time),
        exitPrice: price,
        shares: position.bought,
        profit: proceeds - position.cost,
        return: (proceeds - position.cost) / position.cost,
        bars: index - position.index,
        exitIndex: index,
      });
      position = null;
    }

    pending = null;
    held.push(position !== null);
    equity.push(cash + (position ? position.shares * bar.close : 0));

    if (!position) {
      if (holds(strategy.entry, index)) pending = "buy";
    } else {
      const change =
        adjusted[index].close / (position.price / factors[position.index]) - 1;

      if (
        holds(strategy.exit, index) ||
        (strategy.stopLoss !== undefined && change <= -strategy.stopLoss) ||
        (strategy.takeProfit !== undefined && change >= strategy.takeProfit)
      ) {
        pending = "sell";
      }
    }
  }

  const last = bars.length - 1;

  if (position) {
    const value = position.shares * bars[last].close;

    trades.push({
      entryDate: candleDate(symbol.market, bars[position.index].time),
      entryPrice: position.price,
      exitDate: null,
      exitPrice: bars[last].close,
      shares: position.bought,
      profit: value - position.cost,
      return: (value - position.cost) / position.cost,
      bars: last - position.index,
      exitIndex: null,
    });
  }

  const stretch = (first: number, end: number) =>
    metrics(symbol, adjusted, equity, held, trades, first, end, capital);

  const { split: splitDay } = options;

  const splitAt =
    splitDay === undefined
      ? -1
      : bars.findIndex(
          (bar) => candleDate(symbol.market, bar.time) >= splitDay
        );

  const split = splitAt > 0 && splitAt <= last;

  return {
    capital,
    costs,
    trades: trades.map(({ exitIndex: _, ...trade }) => trade),
    equity: bars.map((bar, index) => ({
      date: candleDate(symbol.market, bar.time),
      value: equity[index],
    })),
    all: stretch(0, last),
    inSample: split ? stretch(0, splitAt - 1) : null,
    outOfSample: split ? stretch(splitAt, last) : null,
  };
}
