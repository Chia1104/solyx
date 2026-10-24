import type { JsonValue } from "@earendil-works/chord";
import { renderDeclarations } from "@earendil-works/pi-codemode";
import type { CodemodeTool } from "@earendil-works/pi-codemode";
import { defineDoc, defineExtension } from "@earendil-works/pi-durable";
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import { omit } from "es-toolkit";
import * as z from "zod";

import {
  BACKTEST_PERMUTATIONS,
  MAX_SCAN_SERIES,
  MAX_SCAN_STRATEGIES,
  backtest,
  ruleStrategySchema,
  scanBacktests,
  tradeCostsSchema,
  walkForward,
} from "@solyx/core/backtest";
import type { BacktestKernel } from "@solyx/core/backtest";
import {
  Interval,
  barTime,
  intervalSchema,
  isIntraday,
} from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import {
  bollinger,
  ema,
  kd,
  macd,
  relativeReturn,
  rsi,
  sma,
  volumeRatio,
  vwap,
} from "@solyx/core/indicators";
import {
  exchangeDate,
  marketSchema,
  symbolRefSchema,
  symbolLabel,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import type { ProposingDesk } from "@solyx/core/order-desk";

import {
  MAX_LISTINGS,
  SOURCE_TYPES,
  listingBudget,
  sourceBudget,
  sourceFunctions,
} from "./analysis-sources.ts";
import type { AnalysisSources } from "./analysis-sources.ts";
import { scriptFunction } from "./script-runner.ts";
import type { ScriptRunner } from "./script-runner.ts";
import { AgentToolName, scriptArgumentsSchema } from "./wire.ts";
import type { RunAnalysisDetails } from "./wire.ts";

/** What a script may read. Nothing here changes anything, and the desk's `propose` is left out. */
export interface AnalysisPorts extends AnalysisSources {
  marketData: Pick<MarketData, "candles">;
  /** A listing's bars from `since` (`YYYY-MM-DD`) on, where that reaches further back than `candles`. */
  candlesSince(
    symbol: SymbolRef,
    interval: Interval,
    since: string
  ): Promise<Candle[]>;
  watchlist(): SymbolRef[];
  desk: Pick<ProposingDesk, "account" | "mode">;
}

export interface AnalysisOptions extends AnalysisPorts {
  scripts: ScriptRunner;
  /** Runs what `backtest.rules` declares. */
  kernel: BacktestKernel;
  /** @default () => new Date() */
  now?: () => Date;
}

const TIMEOUT_MS = 30_000;

/** How far back a script may ask for daily and longer bars. */
const HISTORY_YEARS = 10;

/** How far back a backtest may ask for shorter bars, which each year costs its source a request for too. */
const INTRADAY_HISTORY_YEARS = 3;

// A listing's ten years of daily bars cost its source about a dozen requests, and the source
// answers sixty a minute, which a script's deadline is well inside.
const HISTORY_LISTINGS = 5;

/** The most bars a backtest runs over: a session's minute bars over the furthest back it may read, with room. */
const BACKTEST_BARS = 300_000;

const historyBudget = () =>
  listingBudget(
    HISTORY_LISTINGS,
    `A script reads bars from before the app's own history for at most ${HISTORY_LISTINGS} listings, since each costs its source a request for every year. Leave since out for the rest.`
  );

/** What a conversation's scripts stored for its later scripts to load. */
const AnalysisStoreDoc = defineDoc<{ values: Record<string, JsonValue> }>({
  kind: "solyx.analysis-store",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ values: {} }),
  checkpointWhen: (_value, _ops, { deltasSinceBase }) => deltasSinceBase >= 64,
});

const storedSchema = z.record(z.string(), z.json());

const barSchema = z.object({
  time: z.string().describe("Bar open on the exchange's clock"),
  epoch: z.number().describe("Bar open in UTC seconds"),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().describe("Shares"),
  reference: z
    .number()
    .optional()
    .describe(
      "The price the exchange set the session's move from: the close before, less what went ex that day or divided by a split. Only on closed daily bars"
    ),
});

const valuesSchema = z.array(z.number());

const lineSchema = z.array(z.number().nullable());

const LINE = "(number | null)[]";

/** The app's own indicator maths, so a script's numbers match the chart's. */
const indicators: CodemodeTool[] = [
  scriptFunction({
    name: "indicators.sma",
    description: "Simple moving average; null until `period` values exist.",
    spread: true,
    signature: `(values: number[], period: number): Promise<${LINE}>`,
    input: z.tuple([valuesSchema, z.number().int().positive()]),
    output: lineSchema,
    run: ([values, period]) => sma(values, period),
  }),
  scriptFunction({
    name: "indicators.ema",
    description: "Exponential moving average, seeded with the SMA.",
    spread: true,
    signature: `(values: number[], period: number): Promise<${LINE}>`,
    input: z.tuple([valuesSchema, z.number().int().positive()]),
    output: lineSchema,
    run: ([values, period]) => ema(values, period),
  }),
  scriptFunction({
    name: "indicators.volumeRatio",
    description:
      "Each bar's volume over the average of the 20 bars ending with it; null until 20 bars exist, or where they traded nothing.",
    spread: true,
    signature: `(volumes: number[]): Promise<${LINE}>`,
    input: z.tuple([valuesSchema]),
    output: lineSchema,
    run: ([volumes]) => volumeRatio(volumes),
  }),
  scriptFunction({
    name: "indicators.relativeReturn",
    description:
      "Percentage points by which `values` outran `benchmark` over the `period` bars ending with each; pass the benchmark's closes at the same bars' times, null where it has none. The market's index is TW:IX0001 (TAIEX) in Taiwan.",
    spread: true,
    signature: `(values: number[], benchmark: (number | null)[], period: number): Promise<${LINE}>`,
    input: z.tuple([valuesSchema, lineSchema, z.number().int().positive()]),
    output: lineSchema,
    run: ([values, benchmark, period]) =>
      relativeReturn(values, benchmark, period),
  }),
  scriptFunction({
    name: "indicators.rsi",
    description: "RSI(14).",
    spread: true,
    signature: `(values: number[]): Promise<${LINE}>`,
    input: z.tuple([valuesSchema]),
    output: lineSchema,
    run: ([values]) => rsi(values),
  }),
  scriptFunction({
    name: "indicators.macd",
    description:
      "MACD(12, 26, 9): DIF as `macd`, MACD as `signal`, OSC as `histogram`.",
    spread: true,
    signature: `(values: number[]): Promise<{ macd: ${LINE}; signal: ${LINE}; histogram: ${LINE} }>`,
    input: z.tuple([valuesSchema]),
    output: z.object({
      macd: lineSchema,
      signal: lineSchema,
      histogram: lineSchema,
    }),
    run: ([values]) => macd(values),
  }),
  scriptFunction({
    name: "indicators.bollinger",
    description: "Bollinger Bands(20, 2).",
    spread: true,
    signature: `(values: number[]): Promise<{ upper: ${LINE}; middle: ${LINE}; lower: ${LINE} }>`,
    input: z.tuple([valuesSchema]),
    output: z.object({
      upper: lineSchema,
      middle: lineSchema,
      lower: lineSchema,
    }),
    run: ([values]) => bollinger(values),
  }),
  scriptFunction({
    name: "indicators.vwap",
    description:
      "Each session's VWAP so far, from the bars `tools.candles` returns: their typical prices weighted by volume, starting over each exchange day.",
    spread: true,
    signature: `(market: "TW" | "US", bars: Bar[]): Promise<${LINE}>`,
    input: z.tuple([marketSchema, z.array(barSchema)]),
    output: lineSchema,
    run: ([market, bars]) =>
      vwap(
        market,
        bars.map((bar) => ({ ...omit(bar, ["epoch"]), time: bar.epoch }))
      ),
  }),
  scriptFunction({
    name: "indicators.kd",
    description: "Taiwan-style KD(9), from the bars `tools.candles` returns.",
    spread: true,
    signature: `(bars: Bar[]): Promise<{ k: ${LINE}; d: ${LINE} }>`,
    input: z.tuple([z.array(barSchema)]),
    output: z.object({ k: lineSchema, d: lineSchema }),
    run: ([bars]) =>
      kd(bars.map((bar) => ({ ...omit(bar, ["epoch"]), time: bar.epoch }))),
  }),
];

const metricsSchema = z.object({
  from: z.string(),
  to: z.string(),
  totalReturn: z.number(),
  annualReturn: z.number().nullable(),
  maxDrawdown: z.number(),
  sharpe: z.number().nullable(),
  pValue: z.number().nullable(),
  trades: z.number(),
  winRate: z.number().nullable(),
  payoffRatio: z.number().nullable(),
  exposure: z.number(),
  buyAndHold: z.number(),
  buyAndHoldDrawdown: z.number(),
});

const stretchesSchema = z.object({
  all: metricsSchema,
  inSample: metricsSchema.nullable(),
  outOfSample: metricsSchema.nullable(),
});

const scanSchema = z.object({
  interval: intervalSchema,
  bars: z.number(),
  cells: z.array(stretchesSchema),
  plateau: z
    .object({ cell: z.number(), sharpe: z.number(), edge: z.boolean() })
    .nullable(),
});

const periodSchema = z.object({ from: z.string(), to: z.string() });

const walkForwardSchema = z.object({
  interval: intervalSchema,
  bars: z.number(),
  windows: z.array(
    z.object({
      train: periodSchema,
      test: periodSchema,
      cell: z.number().nullable(),
      trainSharpe: z.number().nullable(),
    })
  ),
  outOfSample: metricsSchema,
  efficiency: z.number().nullable(),
  equity: z.array(z.object({ date: z.string(), value: z.number() })),
});

const backtestSchema = z.object({
  interval: intervalSchema,
  bars: z.number(),
  capital: z.number(),
  costs: tradeCostsSchema,
  trades: z.array(
    z.object({
      entryTime: z.string(),
      entryPrice: z.number(),
      exitTime: z.string().nullable(),
      exitPrice: z.number(),
      shares: z.number(),
      profit: z.number(),
      return: z.number(),
      bars: z.number(),
    })
  ),
  equity: z.array(z.object({ date: z.string(), value: z.number() })),
  all: metricsSchema,
  inSample: metricsSchema.nullable(),
  outOfSample: metricsSchema.nullable(),
});

/** The rule language a backtest reads, declared for the model by hand, since a condition nests in itself. */
export const BACKTEST_TYPES = [
  `type Interval = ${Object.values(Interval)
    .map((interval) => JSON.stringify(interval))
    .join(" | ")};`,
  'type Series = { price: "open" | "high" | "low" | "close" | "volume" } | { value: number } | { sma: number } | { ema: number } | { rsi: number } | { bollinger: number; band: "upper" | "middle" | "lower"; width?: number } | { macd: "macd" | "signal" | "histogram" } | { kd: "k" | "d" } | { highest: number } | { lowest: number };',
  "type Condition = { above: [Series, Series] } | { below: [Series, Series] } | { crossesAbove: [Series, Series] } | { crossesBelow: [Series, Series] } | { all: Condition[] } | { any: Condition[] };",
  "type Strategy = { entry: Condition; exit: Condition; stopLoss?: number; takeProfit?: number };",
  "type Costs = { commissionRate: number; minCommission: number; sellTaxRate: number; slippageTicks: number };",
  "type Metrics = { from: string; to: string; totalReturn: number; annualReturn: number | null; maxDrawdown: number; sharpe: number | null; pValue: number | null; trades: number; winRate: number | null; payoffRatio: number | null; exposure: number; buyAndHold: number; buyAndHoldDrawdown: number };",
  "type Trade = { entryTime: string; entryPrice: number; exitTime: string | null; exitPrice: number; shares: number; profit: number; return: number; bars: number };",
  "type Backtest = { interval: Interval; bars: number; capital: number; costs: Costs; trades: Trade[]; equity: { date: string; value: number }[]; all: Metrics; inSample: Metrics | null; outOfSample: Metrics | null };",
  "type Scan = { interval: Interval; bars: number; cells: { all: Metrics; inSample: Metrics | null; outOfSample: Metrics | null }[]; plateau: { cell: number; sharpe: number; edge: boolean } | null };",
  "type WalkForward = { interval: Interval; bars: number; windows: { train: { from: string; to: string }; test: { from: string; to: string }; cell: number | null; trainSharpe: number | null }[]; outOfSample: Metrics; efficiency: number | null; equity: { date: string; value: number }[] };",
].join("\n");

/** A listing's bars from `since` (`YYYY-MM-DD`) on, which counts against the script's history budget. */
type HistoryReader = (
  symbol: SymbolRef,
  interval: Interval,
  since: string
) => Promise<Candle[]>;

/** Reads bars from `since` on as far back as their interval's history may be read, `admitHistory` asked first. */
function historyReader(
  ports: AnalysisPorts,
  admitHistory: (symbol: SymbolRef) => void,
  now: () => Date
): HistoryReader {
  return (symbol, interval, since) => {
    const years = isIntraday(interval) ? INTRADAY_HISTORY_YEARS : HISTORY_YEARS;

    const earliest = Temporal.PlainDate.from(exchangeDate(symbol.market, now()))
      .subtract({ years })
      .toString();

    if (since < earliest) {
      throw new Error(
        `since goes back ${years} years at most on ${interval} bars, to ${earliest}`
      );
    }

    admitHistory(symbol);

    return ports.candlesSince(symbol, interval, since);
  };
}

/**
 * The app's backtest over bars it reads itself, so a strategy's fills and costs follow its rules,
 * on the listing's own bars, rather than a script's arithmetic or bars a script made.
 */
const backtests = (
  ports: AnalysisPorts,
  kernel: BacktestKernel,
  history: HistoryReader
): CodemodeTool[] => {
  /** A listing's bars as a backtest reads them, and its daily bars where they are shorter. */
  async function listingBars(
    symbol: SymbolRef,
    interval: Interval,
    since: string | undefined
  ) {
    const read = (each: Interval) =>
      since === undefined
        ? ports.marketData.candles(symbol, each)
        : history(symbol, each, since);

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
      interval,
      daily: isIntraday(interval) ? await read(Interval.OneDay) : undefined,
    };
  }

  const strategiesSchema = z
    .array(ruleStrategySchema)
    .min(1)
    .max(MAX_SCAN_STRATEGIES);

  const columnsSchema = z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How many strategies a row of their grid holds, row by row");

  const sessionsSchema = z.number().int().positive().optional();

  // Parsed into the split as core reads it: a day, or a share of the sessions.
  const splitSchema = z
    .union([
      z.iso.date().transform((day) => ({ day })),
      z
        .number()
        .gt(0)
        .lt(1)
        .transform((share) => ({ share })),
    ])
    .optional();

  const reading =
    "reads the listing's bars as backtest.rules does: interval's bars, daily unless named, over the app's own history or from since on";

  return [
    scriptFunction({
      name: "backtest.rules",
      description: `Runs a long-only strategy over a listing's bars, which it reads itself: interval's bars, daily unless named, over the app's own history as tools.candles returns them, or from since on. since reaches back up to ${HISTORY_YEARS} years on daily and longer bars and ${INTRADAY_HISTORY_YEARS} on shorter ones, as far as the source keeps them, for the few listings a script tools.candles' since allows; a run takes ${BACKTEST_BARS} bars at most. Its rules are read at each bar's close from that bar and the ones before it, and acted on at the next bar's open, so no decision sees a price it could not have, and a session's first bar fills after the gap from the close before: series warm up as null, and a rule on a null holds nowhere. highest and lowest read the bars before the one ruled on. A buy spends the account on whole shares and a sale sells them all; stopLoss and takeProfit are fractions from the price paid, read on closes. Rules, stops, buyAndHold and buyAndHoldDrawdown read prices with splits and what went ex made up for from the sessions' references, which bars shorter than a day take from the daily bars; orders fill at prices as traded, and what goes ex while held is bought back in, so a trade's shares are those bought. Costs default to a Taiwan broker's full commission (0.1425%, at least 20 TWD), the securities transaction tax on sales (0.3%, 0.1% for funds) and a tick of slippage each way, on every trade however often it trades; a US trade pays only the slippage. A Taiwan bar locked at its limit fills nothing: a daily bar that traded at one price away from its reference, a shorter one that traded at one price, its session's limit. split, a YYYY-MM-DD or a share of the sessions such as 2/3, measures the sessions before it as in-sample and those from it as out-of-sample. Capital defaults to 1,000,000 in the market's currency. A trade's times are its bars' times, and equity is the account at each session's close. sharpe is of the account's session returns, a year's worth at their pace. pValue is how often the stretch's bars put in a random order did as well as the rules' timing did on them, of ${BACKTEST_PERMUTATIONS} orders held as the run held and charged its costs: below 0.05 the timing beat chance, and it says nothing of whether holding the listing at all paid.`,
      spread: true,
      signature:
        "(input: { symbol: SymbolRef; interval?: Interval; since?: string; strategy: Strategy; capital?: number; costs?: Partial<Costs>; split?: string | number }): Promise<Backtest>",
      input: z.tuple([
        z.object({
          symbol: symbolRefSchema,
          interval: intervalSchema.optional(),
          since: z.iso.date().optional(),
          strategy: ruleStrategySchema,
          capital: z.number().positive().optional(),
          costs: tradeCostsSchema.partial().optional(),
          split: splitSchema,
        }),
      ]),
      output: backtestSchema,
      async run([
        { symbol, interval = Interval.OneDay, since, strategy, ...options },
      ]) {
        const { bars, daily } = await listingBars(symbol, interval, since);

        return backtest(kernel, symbol, bars, strategy, {
          ...options,
          interval,
          daily,
        });
      },
    }),
    scriptFunction({
      name: "backtest.scan",
      description: `Runs each of up to ${MAX_SCAN_STRATEGIES} strategies on its own, as backtest.rules runs one, all at once: it ${reading}, and the strategies read up to ${MAX_SCAN_SERIES} different series between them. Each cell is that strategy's stretches, in the order given, with pValue null, since no timing is tested. Pass columns when the strategies make a grid of two parameters, row by row, one parameter's values down and the other's across: plateau is then the cell whose neighbourhood, it and the cells beside it, had the highest mean Sharpe ratio, in-sample where there is a split, so a cell that did well among neighbours that did not is not picked, and edge says it lies on the grid's border, past which the best may lie.`,
      spread: true,
      signature:
        "(input: { symbol: SymbolRef; interval?: Interval; since?: string; strategies: Strategy[]; columns?: number; capital?: number; costs?: Partial<Costs>; split?: string | number }): Promise<Scan>",
      input: z.tuple([
        z.object({
          symbol: symbolRefSchema,
          interval: intervalSchema.optional(),
          since: z.iso.date().optional(),
          strategies: strategiesSchema,
          columns: columnsSchema,
          capital: z.number().positive().optional(),
          costs: tradeCostsSchema.partial().optional(),
          split: splitSchema,
        }),
      ]),
      output: scanSchema,
      async run([
        { symbol, interval = Interval.OneDay, since, strategies, ...options },
      ]) {
        const { bars, daily } = await listingBars(symbol, interval, since);

        return scanBacktests(kernel, symbol, bars, strategies, {
          ...options,
          interval,
          daily,
        });
      },
    }),
    scriptFunction({
      name: "backtest.walkForward",
      description: `Walks strategies forward: it ${reading}, and each window picks one of the strategies on its train sessions, by the plateau where columns makes them a grid as backtest.scan picks it and else by the highest Sharpe ratio, then runs it on the test sessions after; the next window starts test sessions later. train defaults to two fifths of the sessions and test to a quarter of train, and a training needs a month of sessions for a Sharpe ratio, without which its test holds nothing. The tests run as one, the holding carried from one to the next, so outOfSample is what picking on the past alone did, its timing tested as backtest.rules tests a stretch. efficiency is its Sharpe ratio over the picks' mean training one: well under 1 says the picks were fitted to their training. equity is the account at each session's close from the first test on.`,
      spread: true,
      signature:
        "(input: { symbol: SymbolRef; interval?: Interval; since?: string; strategies: Strategy[]; columns?: number; train?: number; test?: number; capital?: number; costs?: Partial<Costs> }): Promise<WalkForward>",
      input: z.tuple([
        z.object({
          symbol: symbolRefSchema,
          interval: intervalSchema.optional(),
          since: z.iso.date().optional(),
          strategies: strategiesSchema,
          columns: columnsSchema,
          train: sessionsSchema.describe("Sessions each window trains on"),
          test: sessionsSchema.describe(
            "Sessions each window then tests on, and moves on by"
          ),
          capital: z.number().positive().optional(),
          costs: tradeCostsSchema.partial().optional(),
        }),
      ]),
      output: walkForwardSchema,
      async run([
        { symbol, interval = Interval.OneDay, since, strategies, ...options },
      ]) {
        const { bars, daily } = await listingBars(symbol, interval, since);

        return walkForward(kernel, symbol, bars, strategies, {
          ...options,
          interval,
          daily,
        });
      },
    }),
  ];
};

/**
 * The functions a script calls as `tools.<name>`. `admitHistory` is asked before a listing's bars
 * are read from further back than the app's own history.
 */
function dataFunctions(
  ports: AnalysisPorts,
  history: HistoryReader
): CodemodeTool[] {
  /** Bars from `since` on, for the intervals whose history is cheap enough to hand a script. */
  function readSince(symbol: SymbolRef, interval: Interval, since: string) {
    if (isIntraday(interval)) {
      throw new Error(
        `since reaches back on ${Interval.OneDay}, ${Interval.OneWeek} and ${Interval.OneMonth} bars only; ${interval} bars go as far as they do without it`
      );
    }

    return history(symbol, interval, since);
  }

  return [
    scriptFunction({
      name: "candles",
      description: `Every OHLCV bar the app has for a listing, oldest first: about two years of daily bars, three of weekly and five of monthly. since reaches further back on those three intervals, up to ${HISTORY_YEARS} years, for at most ${HISTORY_LISTINGS} listings a script, since each year costs the source a request the first time. Prices are as traded, so a split or what goes ex reads as a fall; close / reference - 1 is a session's move without it, and backtest.rules makes up for it from the references itself. The latest bar is still forming while its session is open.`,
      input: z.object({
        symbol: symbolRefSchema,
        interval: intervalSchema,
        since: z.iso
          .date()
          .optional()
          .describe("The first day to read, YYYY-MM-DD"),
      }),
      output: z.array(barSchema),
      async run({ symbol, interval, since }) {
        const candles =
          since === undefined
            ? await ports.marketData.candles(symbol, interval)
            : await readSince(symbol, interval, since);

        if (candles.length === 0) {
          throw new Error(`No ${interval} bars for ${symbolLabel(symbol)}`);
        }

        return candles.map((candle) => ({
          ...candle,
          time: barTime(symbol.market, interval, candle.time),
          epoch: candle.time,
        }));
      },
    }),
    scriptFunction({
      name: "watchlist",
      description: "The listings the user watches.",
      input: z.object({}),
      output: z.array(symbolRefSchema),
      run: () => ports.watchlist(),
    }),
    scriptFunction({
      name: "account",
      description:
        "Cash per currency, null where the broker cannot read it, and open positions with their average price, in the account the app trades.",
      input: z.object({}),
      output: z.object({
        mode: z.string(),
        cash: z.record(z.string(), z.number().nullable()),
        positions: z.array(
          z.object({
            symbol: symbolRefSchema,
            quantity: z.number(),
            avgPrice: z.number(),
          })
        ),
      }),
      async run() {
        const account = await ports.desk.account();

        return {
          mode: ports.desk.mode,
          cash: account.cash,
          positions: account.positions.map((position) => ({
            symbol: {
              market: position.instrument.market,
              symbol: position.instrument.symbol,
            },
            quantity: position.quantity,
            avgPrice: position.avgPrice,
          })),
        };
      },
    }),
  ];
}

/**
 * `run_analysis`: the agent's own JavaScript, run in a QuickJS VM that can only call the functions
 * given here. A script reads market data, the account and the app's other sources and computes; it
 * has no network, files or timers, and nothing it can call changes anything, so its calls need no
 * approval.
 */
export function createAnalysis(options: AnalysisOptions): Extension {
  const now = options.now ?? (() => new Date());

  // Declared with budgets nothing is counted against.
  const declared = historyReader(options, () => undefined, now);

  const tool: ToolRegistration = {
    name: AgentToolName.RunAnalysis,
    description: [
      "Runs JavaScript you write, to compute over market data: backtests, statistics, comparisons and screens across listings. `code` is the body of an async function, so `await` and `return` work.",
      "It can call only the functions declared below; there is no network, file, timer or module. Print with text(value) or console.log, or return a JSON value. store(key, value) and load(key) keep JSON values for this conversation's later scripts.",
      "What a script fetches stays in the script, so fetch every bar you need there and return only the result. `type Bar` is one item of what tools.candles returns; backtest.rules reads its bars itself.",
      `market, flows and fundamentals read the app's other sources, which count every request against limits the rest of the app shares: a script reads at most ${MAX_LISTINGS} listings through them, so screen the listings that matter rather than every one you can name.`,
      SOURCE_TYPES,
      BACKTEST_TYPES,
      renderDeclarations({
        tools: dataFunctions(options, declared),
        globals: [
          ...indicators,
          ...backtests(options, options.kernel, declared),
          ...sourceFunctions(options, () => undefined),
        ],
      }),
    ].join("\n\n"),
    parameters: omit(z.toJSONSchema(scriptArgumentsSchema, { io: "input" }), [
      "$schema",
    ]),
    // A script changes nothing but what it stores, and only a script that finished stores.
    replay: "safe",
    async execute(params, api, context) {
      const parsed = scriptArgumentsSchema.safeParse(params);

      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

      const saved = await api.commit(
        async (tx) =>
          storedSchema.parse(
            // Copied out of the commit's draft, which a worker cannot be sent.
            JSON.parse(
              JSON.stringify(
                (await tx.doc(AnalysisStoreDoc, api.conversationId)).values
              )
            )
          ),
        context
      );

      // The bars a script reads itself and those its backtests read count against one budget.
      const history = historyReader(options, historyBudget(), now);

      const result = await options.scripts.run(parsed.data.code, {
        tools: dataFunctions(options, history),
        globals: [
          ...indicators,
          ...backtests(options, options.kernel, history),
          ...sourceFunctions(options, sourceBudget()),
        ],
        timeoutMs: TIMEOUT_MS,
        signal: context.abortSignal,
        store: saved,
      });

      if (result.ok) {
        const { set, delete: removed } = result.storeWrites;

        if (Object.keys(set).length > 0 || removed.length > 0) {
          const written = storedSchema.parse(set);

          await api.commit(async (tx) => {
            const store = await tx.doc(AnalysisStoreDoc, api.conversationId);

            store.values = { ...omit(store.values, removed), ...written };
          }, context);
        }
      }

      const details: RunAnalysisDetails = { output: result.output };

      return {
        output: [{ type: "text", text: result.output }],
        details,
        isError: !result.ok,
      };
    },
  };

  return defineExtension({ name: "solyx-analysis", tools: [tool] });
}
