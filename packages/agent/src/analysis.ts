import type { JsonValue } from "@earendil-works/chord";
import { renderDeclarations } from "@earendil-works/pi-codemode";
import type { CodemodeTool } from "@earendil-works/pi-codemode";
import { defineDoc, defineExtension } from "@earendil-works/pi-durable";
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import { omit } from "es-toolkit";
import * as z from "zod";

import { candleDate, intervalSchema, isIntraday } from "@solyx/core/candles";
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
  exchangeTime,
  marketSchema,
  symbolRefSchema,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import type { ProposingDesk } from "@solyx/core/order-desk";

import { scriptFunction } from "./script-runner.ts";
import type { ScriptRunner } from "./script-runner.ts";
import { AgentToolName, scriptArgumentsSchema } from "./wire.ts";
import type { RunAnalysisDetails } from "./wire.ts";

/** What a script may read. Nothing here changes anything, and the desk's `propose` is left out. */
export interface AnalysisPorts {
  marketData: Pick<MarketData, "candles">;
  watchlist(): SymbolRef[];
  desk: Pick<ProposingDesk, "account" | "mode">;
}

export interface AnalysisOptions extends AnalysisPorts {
  scripts: ScriptRunner;
}

const TIMEOUT_MS = 30_000;

/** What a conversation's scripts stored for its later scripts to load. */
const AnalysisStoreDoc = defineDoc<{ values: Record<string, JsonValue> }>({
  kind: "solyx.analysis-store",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ values: {} }),
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

function dataFunctions(ports: AnalysisPorts): CodemodeTool[] {
  return [
    scriptFunction({
      name: "candles",
      description:
        "Every OHLCV bar the app has for a listing, oldest first. The latest bar is still forming while its session is open.",
      input: z.object({ symbol: symbolRefSchema, interval: intervalSchema }),
      output: z.array(barSchema),
      async run({ symbol, interval }) {
        const candles = await ports.marketData.candles(symbol, interval);

        if (candles.length === 0) {
          throw new Error(
            `No ${interval} bars for ${symbol.market} ${symbol.symbol}`
          );
        }

        return candles.map((candle) => ({
          ...candle,
          time: isIntraday(interval)
            ? exchangeTime(symbol.market, new Date(candle.time * 1000))
            : candleDate(symbol.market, candle.time),
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
        "Cash per currency and open positions with their average price, in the account the app trades.",
      input: z.object({}),
      output: z.object({
        mode: z.string(),
        cash: z.record(z.string(), z.number()),
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
 * given here. A script reads market data and the account and computes; it has no network, files or
 * timers, and nothing it can call changes anything, so its calls need no approval.
 */
export function createAnalysis(options: AnalysisOptions): Extension {
  const tools = dataFunctions(options);

  const tool: ToolRegistration = {
    name: AgentToolName.RunAnalysis,
    description: [
      "Runs JavaScript you write, to compute over market data: backtests, statistics, comparisons and screens across listings. `code` is the body of an async function, so `await` and `return` work.",
      "It can call only the functions declared below; there is no network, file, timer or module. Print with text(value) or console.log, or return a JSON value. store(key, value) and load(key) keep JSON values for this conversation's later scripts.",
      "What a script fetches stays in the script, so fetch every bar you need there and return only the result. `type Bar` is one item of what tools.candles returns.",
      renderDeclarations({ tools, globals: indicators }),
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

      const result = await options.scripts.run(parsed.data.code, {
        tools,
        globals: indicators,
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
        content: [{ type: "text", text: result.output }],
        details,
        isError: !result.ok,
      };
    },
  };

  return defineExtension({ name: "solyx-analysis", tools: [tool] });
}
