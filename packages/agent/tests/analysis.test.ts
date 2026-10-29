import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, expect, test, vi } from "vite-plus/test";
import * as z from "zod";

import { BrokerMode } from "@solyx/core/broker";
import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Investor } from "@solyx/core/flows";
import type { InvestorTrades } from "@solyx/core/flows";
import type { Dividend } from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";
import { SectorGroup, TwSector } from "@solyx/core/sectors";
import { kernel } from "@solyx/kernel/kernel";

import { MAX_LISTINGS } from "../src/analysis-sources.ts";
import type { AnalysisSources } from "../src/analysis-sources.ts";
import { createAnalysis } from "../src/analysis.ts";
import type { AnalysisPorts } from "../src/analysis.ts";
import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { createScriptRunner } from "../src/script-runner.ts";
import {
  AgentEventType,
  AgentToolName,
  ToolCallStatus,
  runAnalysisDetailsSchema,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

const DAY = 24 * 60 * 60;

// 2026-10-13 10:42 in Taipei.
const NOW = new Date("2026-10-13T02:42:00Z");

/** `count` daily bars from 2025-06-15 on, closing at 101, 102, and so on. */
const risingBars = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => ({
    time: 1_750_000_000 + index * DAY,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1000,
  }));

const BARS = risingBars(30);

const trade = (
  date: string,
  investor: Investor,
  bought: number,
  sold: number
): InvestorTrades => ({ date, investor, bought, sold });

/** The app's other sources as a script reads them, each counting what it was asked. */
function fakeSources() {
  return {
    quote: vi.fn<AnalysisSources["quote"]>(async ({ symbol }) =>
      symbol === "9999"
        ? null
        : {
            date: "2026-10-13",
            hours: { open: 0, close: 0 },
            line: [],
            last: 1085,
            previousClose: 1070,
          }
    ),
    sectors: vi.fn<AnalysisSources["sectors"]>(async () => [
      {
        sector: TwSector.Semiconductors,
        group: SectorGroup.Electronics,
        symbol: "IX0028",
        quote: {
          date: "2026-10-13",
          last: 1212,
          reference: 1200,
          tradeValue: 9e10,
        },
      },
      {
        sector: TwSector.Glass,
        group: SectorGroup.Other,
        symbol: "IX0022",
        quote: null,
      },
    ]),
    flows: {
      listing: vi.fn<AnalysisSources["flows"]["listing"]>(async () => ({
        trades: [
          trade("2026-10-12", Investor.Foreign, 9000, 4000),
          trade("2026-10-13", Investor.Foreign, 8000, 2000),
        ],
        margin: [],
        foreign: [],
      })),
    },
    fundamentals: {
      statements: vi.fn<AnalysisSources["fundamentals"]["statements"]>(
        async () => [
          {
            periodEnd: "2026-06-30",
            knownFrom: "2026-08-14",
            revenue: 1000,
            grossProfit: 550,
            operatingIncome: 450,
            netIncome: 400,
            eps: 15,
          },
        ]
      ),
      monthlyRevenue: vi.fn<AnalysisSources["fundamentals"]["monthlyRevenue"]>(
        async () => [
          { month: "2025-09", revenue: 200 },
          { month: "2026-09", revenue: 260 },
        ]
      ),
      multiples: vi.fn<AnalysisSources["fundamentals"]["multiples"]>(
        async () => ({
          asOf: "2026-10-12",
          priceToEarnings: 24.5,
          dividendYield: 1.6,
          priceToBook: 6.1,
        })
      ),
      dividends: vi.fn<AnalysisSources["fundamentals"]["dividends"]>(
        async () => []
      ),
      company: vi.fn<AnalysisSources["fundamentals"]["company"]>(async () => ({
        industry: { code: "24", name: "半導體業" },
        shares: 25_932_370_067,
      })),
    },
  };
}

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** The agent on the analysis tool alone over `bars`, running each of `scripts` in one conversation. */
const analyzeOver = (bars: Candle[], ...scripts: string[]) =>
  analyzeWith({ bars }, ...scripts);

/** As `analyzeOver`, with the user's strategies where `strategies` gives them and the distributions `dividends` gives. */
async function analyzeWith(
  {
    bars,
    strategies,
    dividends = [],
  }: {
    bars: Candle[];
    strategies?: AnalysisPorts["strategies"];
    dividends?: Dividend[];
  },
  ...scripts: string[]
) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const candles = vi.fn(async () => bars);
  const candlesSince = vi.fn(async () => bars);
  const sources = fakeSources();

  sources.fundamentals.dividends.mockResolvedValue(dividends);
  models.setProvider(faux.provider);

  const runner = createScriptRunner();

  const analysis = createAnalysis({
    marketData: { candles },
    watchlist: () => [{ market: Market.TW, symbol: "2330" }],
    desk: {
      mode: BrokerMode.Paper,
      account: async () => ({ cash: { TWD: 1_000_000 }, positions: [] }),
    },
    candlesSince,
    ...sources,
    strategies,
    scripts: runner,
    kernel,
    now: () => NOW,
  });

  const runtime = createAgentRuntime({
    store: Promise.resolve({
      storage: new MemoryStorage(),
      deleteConversation: vi.fn(async () => undefined),
    }),
    models,
    model: async () => ({
      model: faux.getModel(),
      thinking: AgentThinking.Off,
    }),
    tools: async () => ({ offered: [analysis], deferred: [] }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  closers.push(async () => {
    await runtime.close();
    await runner.close();
  });

  faux.setResponses([
    ...scripts.map((code) =>
      fauxAssistantMessage(fauxToolCall(AgentToolName.RunAnalysis, { code }), {
        stopReason: "toolUse",
      })
    ),
    fauxAssistantMessage("Done."),
  ]);

  const { id } = await runtime.create();

  await runtime.send(id, { text: "Analyze", context: "" });
  await vi.waitFor(() =>
    expect(events.at(-1)).toMatchObject({ type: AgentEventType.RunEnd })
  );

  const results = events.flatMap((event) =>
    event.type === AgentEventType.ToolEnd
      ? [
          {
            status: event.status,
            ...runAnalysisDetailsSchema.parse(event.details),
          },
        ]
      : []
  );

  return {
    results,
    candles,
    candlesSince,
    sources,
    description: analysis.tools?.[0].description,
  };
}

const analyze = (...scripts: string[]) => analyzeOver(BARS, ...scripts);

test("a script reads bars and computes with the app's indicators", async () => {
  const { results, candles } = await analyze(`
    const bars = await tools.candles({
      symbol: { market: "${Market.TW}", symbol: "2330" },
      interval: "${Interval.OneDay}",
    });
    const average = await indicators.sma(bars.map((bar) => bar.close), 5);
    text("bars " + bars.length);
    return { last: bars.at(-1).close, sma5: average.at(-1), first: average[0] };
  `);

  expect(candles).toHaveBeenCalledOnce();
  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: 'bars 30\nResult: {"last":130,"sma5":128,"first":null}',
    },
  ]);
});

test("a script backtests rules over the listing's bars, which the engine reads and fills at the next open", async () => {
  const { results, description, candles } = await analyze(`
    const symbol = { market: "${Market.TW}", symbol: "2330" };
    const result = await backtest.rules({
      symbol,
      strategy: {
        entry: { above: [{ price: "close" }, { value: 110 }] },
        exit: { below: [{ price: "close" }, { sma: 5 }] },
      },
      costs: { commissionRate: 0, minCommission: 0, sellTaxRate: 0, slippageTicks: 0 },
    });
    const [trade] = result.trades;
    // Run again as it was, which the call keeps once.
    await backtest.rules({
      symbol,
      strategy: {
        entry: { above: [{ price: "close" }, { value: 110 }] },
        exit: { below: [{ price: "close" }, { sma: 5 }] },
      },
      costs: { commissionRate: 0, minCommission: 0, sellTaxRate: 0, slippageTicks: 0 },
    });
    return [result.trades.length, trade.entryPrice, trade.exitTime, result.all.trades];
  `);

  expect(candles).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "2330" },
    Interval.OneDay
  );
  // The close of 111 is the first past 110, so the next bar's open of 111 buys; nothing sells.
  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: "Result: [1,111,null,0]",
      // Kept as it asked for it, so the thread opens it in the backtest panel.
      backtests: [
        {
          symbol: { market: Market.TW, symbol: "2330" },
          interval: Interval.OneDay,
          strategy: {
            entry: { above: [{ price: "close" }, { value: 110 }] },
            exit: { below: [{ price: "close" }, { sma: 5 }] },
          },
          costs: {
            commissionRate: 0,
            minCommission: 0,
            sellTaxRate: 0,
            slippageTicks: 0,
          },
        },
      ],
    },
  ]);
  expect(description).toContain("type Strategy = { entry: Condition;");
  expect(description).toContain("declare const backtest: {");
});

test("a script's backtest of a US listing withholds tax from what went ex while held, and holding pays it too", async () => {
  // Went ex of 2 on 2025-06-25, the eleventh bar, from a close of 110.
  const bars = risingBars(30).map((bar, index) =>
    index === 10 ? { ...bar, reference: 108 } : bar
  );

  const { results, sources } = await analyzeWith(
    {
      bars,
      dividends: [
        {
          period: "Q2 2025",
          announced: "2025-06-01",
          cash: 2,
          stock: 0,
          cashExDate: "2025-06-25",
          cashPaidOn: "2025-07-15",
          stockExDate: null,
        },
      ],
    },
    `
    const symbol = { market: "${Market.US}", symbol: "KO" };
    const strategy = {
      entry: { above: [{ price: "close" }, { value: 0 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    };
    const withheld = await backtest.rules({ symbol, strategy });
    const kept = await backtest.rules({ symbol, strategy, costs: { dividendTaxRate: 0 } });
    return [withheld.costs.dividendTaxRate, withheld.all.buyAndHold, kept.all.buyAndHold];
  `
  );

  const [rate, withheld, kept] = z
    .tuple([z.number(), z.number(), z.number()])
    .parse(JSON.parse(results[0].output.replace("Result: ", "")));

  expect(rate).toBe(0.3);
  expect(withheld).toBeCloseTo((130 * (110 - 2 * 0.3)) / (108 * 101) - 1);
  expect(kept).toBeCloseTo((130 * 110) / (108 * 101) - 1);
  expect(sources.fundamentals.dividends).toHaveBeenCalledOnce();
  expect(sources.fundamentals.dividends).toHaveBeenCalledWith({
    market: Market.US,
    symbol: "KO",
  });
});

test("a script scans a grid of strategies and walks them forward over the same bars", async () => {
  const { results, candles, description } = await analyze(`
    const symbol = { market: "${Market.TW}", symbol: "2330" };
    const strategies = [];
    for (const entry of [105, 110]) {
      for (const exit of [0, 120]) {
        strategies.push({
          entry: { above: [{ price: "close" }, { value: entry }] },
          exit: { below: [{ price: "close" }, { value: exit }] },
        });
      }
    }
    const scan = await backtest.scan({ symbol, strategies, columns: 2, split: 2 / 3 });
    const walked = await backtest.walkForward({ symbol, strategies, columns: 2, train: 20, test: 5 });
    return [scan.cells.length, scan.cells[0].all.pValue, scan.cells[0].outOfSample.from, walked.windows.length, walked.outOfSample.from];
  `);

  expect(candles).toHaveBeenCalledTimes(2);
  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      // Two thirds of the thirty sessions are twenty.
      output: 'Result: [4,null,"2025-07-05",2,"2025-07-05"]',
    },
  ]);
  expect(description).toContain("scan(input: {");
  expect(description).toContain("walkForward(input: {");
});

test("a script runs one strategy over rolling windows of whole months", async () => {
  // From 2025-06-15 to 2025-10-12: July, August and September start a whole month each.
  const { results, description } = await analyzeOver(
    risingBars(120),
    `
    const rolled = await backtest.rolling({
      symbol: { market: "${Market.TW}", symbol: "2330" },
      strategy: {
        entry: { above: [{ price: "close" }, { value: 0 }] },
        exit: { below: [{ price: "close" }, { value: 0 }] },
      },
      months: 1,
    });
    return [rolled.windows.map((window) => window.from), rolled.summary.apart, rolled.summary.gained];
  `
  );

  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: 'Result: [["2025-07-01","2025-08-01","2025-09-01"],3,1]',
    },
  ]);
  expect(description).toContain("rolling(input: {");
  expect(description).toContain("type Rolling = {");
});

test("a backtest on minute bars reads them from further back with the daily bars, from three years back at most", async () => {
  const run = (since: string) => `
    const result = await backtest.rules({
      symbol: { market: "${Market.TW}", symbol: "2330" },
      interval: "${Interval.OneMinute}",
      since: "${since}",
      strategy: {
        entry: { above: [{ price: "close" }, { value: 110 }] },
        exit: { below: [{ price: "close" }, { value: 0 }] },
      },
    });
    return [result.interval, result.bars];
  `;

  const { results, candlesSince } = await analyze(
    run("2024-01-02"),
    run("2023-01-02")
  );

  // Minute bars reach back three years from NOW, and the daily bars beside them ten.
  expect(candlesSince.mock.calls).toEqual([
    [{ market: Market.TW, symbol: "2330" }, Interval.OneMinute, "2024-01-02"],
    [{ market: Market.TW, symbol: "2330" }, Interval.OneDay, "2024-01-02"],
    [{ market: Market.TW, symbol: "2330" }, Interval.OneMinute, "2023-10-13"],
    [{ market: Market.TW, symbol: "2330" }, Interval.OneDay, "2023-01-02"],
  ]);
  expect(results.map((result) => result.output)).toEqual([
    `Result: ["${Interval.OneMinute}",30]`,
    `Result: ["${Interval.OneMinute}",30]`,
  ]);
});

test("what a script stores is there for the conversation's next script", async () => {
  const { results } = await analyze(
    `store("runs", (load("runs") ?? 0) + 1);`,
    `return load("runs");`
  );

  expect(results.map((result) => result.output)).toEqual([
    "The script printed nothing and returned nothing.",
    "Result: 1",
  ]);
});

test("a script reaches nothing outside its sandbox, and its failure is told to the model", async () => {
  const { results } = await analyze(
    `return [typeof fetch, typeof process, typeof require, typeof setTimeout];`,
    `await tools.candles({ symbol: "2330" });`
  );

  expect(results[0]).toEqual({
    status: ToolCallStatus.Ok,
    output: 'Result: ["undefined","undefined","undefined","undefined"]',
  });
  expect(results[1]).toMatchObject({ status: ToolCallStatus.Error });
  expect(results[1]?.output).toContain("symbol");
});

test("a script reads quotes, sectors, flows and filings, with the figures the app computes from them", async () => {
  const { results, sources } = await analyze(`
    const tsmc = { market: "${Market.TW}", symbol: "2330" };
    const [quote, none, sectors, traded, quarters, months, multiples, company] = await Promise.all([
      market.quote(tsmc),
      market.quote({ market: "${Market.TW}", symbol: "9999" }),
      market.sectors(),
      flows.listing(tsmc),
      fundamentals.statements(tsmc),
      fundamentals.monthlyRevenue(tsmc),
      fundamentals.multiples(tsmc),
      fundamentals.company(tsmc),
    ]);
    const [foreign] = await flows.netBuying(traded.trades);
    return {
      quote: [quote.last, quote.change, Number(quote.percent.toFixed(4))],
      none,
      sectors: sectors.map((sector) => [sector.sector, sector.percent, sector.share]),
      foreign: [foreign.investor, foreign.session, foreign.week, foreign.streak],
      grossMargin: quarters[0].grossMargin,
      yoy: months.at(-1).yoy,
      pe: multiples.priceToEarnings,
      value: company.shares * quote.last,
    };
  `);

  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: `Result: ${JSON.stringify({
        quote: [1085, 15, 0.014],
        none: null,
        sectors: [["semiconductors", 0.01, 1]],
        foreign: ["foreign", 6000, 11_000, 2],
        grossMargin: 0.55,
        yoy: 0.3,
        pe: 24.5,
        value: 25_932_370_067 * 1085,
      })}`,
    },
  ]);
  expect(sources.flows.listing).toHaveBeenCalledWith({
    market: Market.TW,
    symbol: "2330",
  });
});

test("a script reads the counted sources for a limited number of listings, and the exchange's own list for any", async () => {
  const { results, sources } = await analyze(`
    const listings = Array.from({ length: ${MAX_LISTINGS} + 1 }, (_, index) => ({
      market: "${Market.TW}",
      symbol: String(1101 + index),
    }));
    const multiples = await Promise.all(listings.map((each) => fundamentals.multiples(each)));
    const quotes = await Promise.all(listings.slice(0, ${MAX_LISTINGS}).map((each) => market.quote(each)));
    text(multiples.length + " multiples, " + quotes.length + " quotes");
    await flows.listing(listings[0]);
    await flows.listing(listings.at(-1));
  `);

  expect(results).toEqual([
    {
      status: ToolCallStatus.Error,
      output: expect.stringMatching(
        /^51 multiples, 50 quotes\n.*at most 50 listings/s
      ),
    },
  ]);
  // A listing already read is read again; the one past the limit never reaches its source.
  expect(sources.flows.listing).toHaveBeenCalledOnce();
});

test("the tool declares the sources' functions under their names, on types written once", async () => {
  const { description } = await analyze();

  expect(description).toContain("type ListingFlows = {");
  expect(description).toContain("type Company = {");
  expect(description).toContain(
    "listing(symbol: SymbolRef): Promise<ListingFlows>;"
  );
  expect(description).toContain("declare const fundamentals: {");
});

test("a script reads daily bars from further back and carries them over what split or went ex", async () => {
  const { results, candles, candlesSince } = await analyze(`
    const tsmc = { market: "${Market.TW}", symbol: "2330" };
    const bars = await tools.candles({ symbol: tsmc, interval: "${Interval.OneDay}", since: "2018-01-02" });
    const bar = (time, close, reference) => ({ time, epoch: 0, open: close, high: close, low: close, close, volume: 1, reference });
    const adjustment = await indicators.adjustment([
      bar("2026-06-09", 100),
      // Split four for one, then gone ex of 5.
      bar("2026-06-10", 25, 25),
      bar("2026-06-11", 20, 20),
    ]);
    return { bars: bars.length, adjustment };
  `);

  expect(candlesSince).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "2330" },
    Interval.OneDay,
    "2018-01-02"
  );
  expect(candles).not.toHaveBeenCalled();
  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: 'Result: {"bars":30,"adjustment":[1,0.25,0.2]}',
    },
  ]);
});

test("bars from further back are refused on short intervals and for more than a few listings, and read from ten years back at most", async () => {
  const read = (symbol: string, interval: Interval, since: string) =>
    `await tools.candles({ symbol: { market: "${Market.TW}", symbol: "${symbol}" }, interval: "${interval}", since: "${since}" });`;

  const { results, candlesSince } = await analyze(
    read("2330", Interval.FiveMinutes, "2026-01-02"),
    read("2330", Interval.OneDay, "2016-10-12"),
    ["2330", "2317", "2454", "2308", "2382", "2330", "2881"]
      .map((symbol) => read(symbol, Interval.OneWeek, "2020-01-02"))
      .join("\n")
  );

  expect(results.map((result) => result.status)).toEqual([
    ToolCallStatus.Error,
    ToolCallStatus.Ok,
    ToolCallStatus.Error,
  ]);
  expect(results[0].output).toContain("since reaches back on 1d, 1w and 1mo");
  // A day past ten years before NOW, on Taipei's calendar, reads from ten years back.
  expect(candlesSince).toHaveBeenNthCalledWith(
    1,
    { market: Market.TW, symbol: "2330" },
    Interval.OneDay,
    "2016-10-13"
  );
  expect(results[2].output).toContain("for at most 5 listings");
  // Five listings and one of them again, then the sixth is refused before its source is asked.
  expect(candlesSince).toHaveBeenCalledTimes(7);
});

test("a script backtests a strategy the user wrote on the lines its code worked out, the engine filling its rules", async () => {
  const lines = vi.fn<NonNullable<AnalysisPorts["strategies"]>["lines"]>(
    async (_name, _symbol, candles, _bars, params) => ({
      rules: {
        entry: { crossesAbove: [{ line: "close" }, { line: "level" }] },
        exit: { crossesBelow: [{ line: "close" }, { line: "level" }] },
      },
      params: params.map((each) => ({ level: 115, ...each })),
      lines: params.map((each) => ({
        close: candles.map((bar) => bar.close),
        level: candles.map(() => each.level ?? 115),
      })),
      lookAhead: { line: "level", time: "2025-06-20" },
    })
  );

  const { results, description } = await analyzeWith(
    { bars: BARS, strategies: { lines } },
    `
    const symbol = { market: "${Market.TW}", symbol: "2330" };
    const costs = { commissionRate: 0, minCommission: 0, sellTaxRate: 0, slippageTicks: 0 };
    const run = await strategies.backtest({ strategy: "crossing", symbol, costs });
    const scan = await strategies.scan({ strategy: "crossing", symbol, params: [{ level: 110 }, { level: 120 }, { level: 200 }] });
    const signal = await strategies.signal({ strategy: "crossing", symbol });
    return [run.trades[0].entryPrice, run.params, run.lookAhead.line, scan.cells.map((cell) => cell.all.trades), scan.params.length, signal];
  `
  );

  expect(lines).toHaveBeenCalledWith(
    "crossing",
    { market: Market.TW, symbol: "2330" },
    BARS,
    { interval: Interval.OneDay, daily: undefined },
    [{}]
  );
  // The close of 116 is the first past 115, so the next bar's open of 116 buys and nothing sells.
  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: `Result: [116,{"level":115},"level",[0,0,0],3,${JSON.stringify({
        time: "2025-07-14",
        entry: false,
        exit: false,
        // The signal's backtest pays a tick of slippage, as the app's costs have it.
        holding: { since: "2025-07-01", price: 116.5 },
        params: { level: 115 },
        lookAhead: { line: "level", time: "2025-06-20" },
      })}]`,
    },
  ]);
  expect(description).toContain("type LookAhead = {");
  expect(description).toContain("declare const strategies: {");
});

test("a script reads the lines a strategy's code worked out beside the bars as the code was handed them", async () => {
  const lines = vi.fn<NonNullable<AnalysisPorts["strategies"]>["lines"]>(
    async (_name, _symbol, candles, _bars, params) => ({
      rules: {
        entry: { crossesAbove: [{ line: "close" }, { line: "level" }] },
        exit: { crossesBelow: [{ line: "close" }, { line: "level" }] },
      },
      params: params.map((each) => ({ level: 115, ...each })),
      lines: params.map(() => ({
        level: candles.map((_, index) => (index === 0 ? null : 115)),
      })),
      lookAhead: null,
    })
  );

  const { results } = await analyzeWith(
    { bars: BARS, strategies: { lines } },
    `
    const run = await strategies.lines({ strategy: "crossing", symbol: { market: "${Market.TW}", symbol: "2330" }, params: { level: 120 } });
    return [run.bars.time.length === run.lines.level.length, run.bars.time[0], run.bars.close[0] === ${BARS[0].close}, run.lines.level.slice(0, 2), run.params, run.lookAhead];
  `
  );

  expect(lines).toHaveBeenCalledWith(
    "crossing",
    { market: Market.TW, symbol: "2330" },
    BARS,
    { interval: Interval.OneDay, daily: undefined },
    [{ level: 120 }]
  );
  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: `Result: [true,"${new Date(BARS[0].time * 1000).toISOString().slice(0, 10)}",true,[null,115],{"level":120},null]`,
    },
  ]);
});

test("without the user's strategies the tool declares none of their functions", async () => {
  const { description } = await analyze("return 1");

  expect(description).not.toContain("declare const strategies");
  expect(description).not.toContain("type LookAhead");
});
