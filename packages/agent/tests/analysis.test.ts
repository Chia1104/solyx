import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Investor } from "@solyx/core/flows";
import type { InvestorTrades } from "@solyx/core/flows";
import { Market } from "@solyx/core/market";
import { SectorGroup, TwSector } from "@solyx/core/sectors";
import { kernel } from "@solyx/kernel/kernel";

import { MAX_LISTINGS } from "../src/analysis-sources.ts";
import type { AnalysisSources } from "../src/analysis-sources.ts";
import { createAnalysis } from "../src/analysis.ts";
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

// Thirty daily bars closing at 101, 102, … 130.
const BARS: Candle[] = Array.from({ length: 30 }, (_, index) => ({
  time: 1_750_000_000 + index * DAY,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 1000,
}));

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

/** The agent on the analysis tool alone, running each of `scripts` in one conversation. */
async function analyze(...scripts: string[]) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const candles = vi.fn(async () => BARS);
  const candlesSince = vi.fn(async () => BARS);
  const sources = fakeSources();

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
            output: runAnalysisDetailsSchema.parse(event.details).output,
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
    return [result.trades.length, trade.entryPrice, trade.exitTime, result.all.trades];
  `);

  expect(candles).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "2330" },
    Interval.OneDay
  );
  // The close of 111 is the first past 110, so the next bar's open of 111 buys; nothing sells.
  expect(results).toEqual([
    { status: ToolCallStatus.Ok, output: "Result: [1,111,null,0]" },
  ]);
  expect(description).toContain("type Strategy = { entry: Condition;");
  expect(description).toContain("declare const backtest: {");
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
    const scan = await backtest.scan({ symbol, strategies, columns: 2 });
    const walked = await backtest.walkForward({ symbol, strategies, columns: 2, train: 20, test: 5 });
    return [scan.cells.length, scan.cells[0].all.pValue, scan.plateau === null, walked.windows.length, walked.outOfSample.from];
  `);

  expect(candles).toHaveBeenCalledTimes(2);
  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: 'Result: [4,null,false,2,"2025-07-05"]',
    },
  ]);
  expect(description).toContain("scan(input: {");
  expect(description).toContain("walkForward(input: {");
});

test("a backtest on minute bars reads them from further back with the daily bars, but not past three years", async () => {
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

  expect(candlesSince.mock.calls).toEqual([
    [{ market: Market.TW, symbol: "2330" }, Interval.OneMinute, "2024-01-02"],
    [{ market: Market.TW, symbol: "2330" }, Interval.OneDay, "2024-01-02"],
  ]);
  expect(results[0]).toEqual({
    status: ToolCallStatus.Ok,
    output: `Result: ["${Interval.OneMinute}",30]`,
  });
  expect(results[1].status).toBe(ToolCallStatus.Error);
  expect(results[1].output).toContain(
    "since goes back 3 years at most on 1m bars"
  );
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

test("a script reads daily bars from further back and adds back the cash that went ex", async () => {
  const { results, candles, candlesSince } = await analyze(`
    const tsmc = { market: "${Market.TW}", symbol: "2330" };
    const bars = await tools.candles({ symbol: tsmc, interval: "${Interval.OneDay}", since: "2018-01-02" });
    const cash = await fundamentals.cashGoneEx(
      [{ time: "2026-06-09" }, { time: "2026-06-10" }, { time: "2026-06-11" }],
      [{ period: "Q1", announced: null, cash: 6, stock: 0, cashExDate: "2026-06-11", cashPaidOn: null, stockExDate: null }]
    );
    return { bars: bars.length, cash };
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
      output: 'Result: {"bars":30,"cash":[0,0,6]}',
    },
  ]);
});

test("bars from further back are refused on short intervals, past ten years and for more than a few listings", async () => {
  const read = (symbol: string, interval: Interval, since: string) =>
    `await tools.candles({ symbol: { market: "${Market.TW}", symbol: "${symbol}" }, interval: "${interval}", since: "${since}" });`;

  const { results, candlesSince } = await analyze(
    read("2330", Interval.FiveMinutes, "2026-01-02"),
    read("2330", Interval.OneDay, "2016-10-13"),
    ["2330", "2317", "2454", "2308", "2382", "2330", "2881"]
      .map((symbol) => read(symbol, Interval.OneWeek, "2020-01-02"))
      .join("\n")
  );

  expect(results.map((result) => result.status)).toEqual([
    ToolCallStatus.Error,
    ToolCallStatus.Error,
    ToolCallStatus.Error,
  ]);
  expect(results[0].output).toContain("since reaches back on 1d, 1w and 1mo");
  expect(results[1].output).toContain(
    "since goes back 10 years at most on 1d bars, to 2016-10-15"
  );
  expect(results[2].output).toContain("for at most 5 listings");
  // Five listings and one of them again, then the sixth is refused before its source is asked.
  expect(candlesSince).toHaveBeenCalledTimes(6);
});
