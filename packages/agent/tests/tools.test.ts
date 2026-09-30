import type { AgentTool } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import { expect, test, vi } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { InstrumentKind, Market } from "@solyx/core/market";
import type { MarketDataProvider } from "@solyx/core/market-data";
import { OrderType, Side } from "@solyx/core/order";
import { ProposalSource, ProposalStatus } from "@solyx/core/order-desk";
import type { OrderDesk, TradeProposal } from "@solyx/core/order-desk";
import { RiskViolationCode } from "@solyx/core/risk";

import { SkillSource } from "../src/skills.ts";
import { createTradingTools } from "../src/tools.ts";
import { AgentToolName } from "../src/wire.ts";

/** What pi hands a tool after checking it against the JSON Schema. */
type ToolArguments = Parameters<AgentTool["execute"]>[1];

// 2026-09-30 10:00 in Taipei, during the regular session.
const NOW = new Date("2026-09-30T02:00:00Z");

const TSMC = { market: Market.TW, symbol: "2330" };

function dailyBars(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 1000 + i;

    return {
      // Midnight Taipei time on consecutive days ending the day before NOW.
      time: Date.UTC(2026, 8, 30 - count + i, -8) / 1000,
      open: close - 2,
      high: close + 3,
      low: close - 4,
      close,
      volume: 1000 * (i + 1),
    };
  });
}

function setup(candles: Candle[] = dailyBars(80)) {
  const provider: MarketDataProvider = {
    id: "fake",
    markets: [Market.TW],
    getCandles: vi.fn(async () => candles),
    getListing: vi.fn(async () => null),
  };

  const proposal = (overrides: Partial<TradeProposal>): TradeProposal => ({
    id: "p1",
    order: {
      instrument: { ...TSMC, kind: InstrumentKind.Stock },
      side: Side.Buy,
      quantity: 1000,
      type: OrderType.Limit,
      limitPrice: 1000,
    },
    source: ProposalSource.Agent,
    rationale: "breakout",
    createdAt: NOW.getTime(),
    status: ProposalStatus.AwaitingConfirmation,
    violations: [],
    ...overrides,
  });

  const desk = {
    check: vi.fn<OrderDesk["check"]>(async () => []),
    propose: vi.fn<OrderDesk["propose"]>(async () => proposal({})),
    list: vi.fn<OrderDesk["list"]>(() => []),
  };

  const tools = createTradingTools({
    marketData: async (market) => (market === Market.TW ? provider : undefined),
    watchlist: () => [TSMC],
    account: async () => ({ cash: { TWD: 1_000_000 }, positions: [] }),
    brokerMode: BrokerMode.Paper,
    desk,
    skills: [
      {
        name: "breakout-watch",
        description: "Mine",
        body: "# Breakout watch",
        source: SkillSource.Solyx,
      },
    ],
    now: () => NOW,
  });

  const run = async (name: AgentToolName, params: ToolArguments) => {
    const tool = tools.find((candidate) => candidate.name === name);

    if (!tool) throw new Error(`No tool ${name}`);

    const result = await tool.execute("call", params);

    return { text: contentText(result.content), details: result.details };
  };

  return { run, desk, provider };
}

const order = {
  market: Market.TW,
  symbol: "2330",
  kind: InstrumentKind.Stock,
  side: Side.Buy,
  quantity: 1000,
  type: OrderType.Limit,
  limitPrice: 1000,
};

test("candles come oldest first on the exchange's clock, capped to the count", async () => {
  const { run } = setup();

  const { text } = await run(AgentToolName.GetCandles, {
    symbol: TSMC,
    interval: Interval.OneDay,
    count: 3,
  });

  const lines = text.split("\n");

  expect(lines[0]).toContain("as_of 2026-09-29");
  expect(lines.slice(1)).toEqual([
    "time,open,high,low,close,volume",
    "2026-09-27,1075,1080,1073,1077,78000",
    "2026-09-28,1076,1081,1074,1078,79000",
    "2026-09-29,1077,1082,1075,1079,80000",
  ]);
});

test("a market without a source is reported, not guessed", async () => {
  const { run } = setup();

  await expect(
    run(AgentToolName.GetCandles, {
      symbol: { market: Market.US, symbol: "AAPL" },
      interval: Interval.OneDay,
    })
  ).rejects.toThrow("No market data for US");
});

test("indicators report the latest and previous values", async () => {
  const { run } = setup();

  const { text } = await run(AgentToolName.GetIndicators, {
    symbol: TSMC,
    interval: Interval.OneDay,
  });

  expect(text).toContain("close: 1079 (previous 1078)");
  expect(text).toContain("MA5: 1077 (previous 1076)");
});

test("a limit order needs its price", async () => {
  const { run, desk } = setup();

  await expect(
    run(AgentToolName.CheckOrder, {
      order: { ...order, limitPrice: undefined },
    })
  ).rejects.toThrow("limitPrice");
  expect(desk.check).not.toHaveBeenCalled();
});

test("checking reports each violation", async () => {
  const { run, desk } = setup();

  desk.check.mockResolvedValueOnce([
    { code: RiskViolationCode.InvalidPrice, price: 1000.5, tick: 5 },
  ]);

  const { text } = await run(AgentToolName.CheckOrder, {
    order: { ...order, limitPrice: 1000.5 },
  });

  expect(text).toContain("invalid-price");
});

test("proposing goes through the desk as the agent, once per run", async () => {
  const { run, desk } = setup();

  const { details } = await run(AgentToolName.ProposeOrder, {
    order,
    rationale: "breakout above 1000",
  });

  expect(details).toEqual({ proposalId: "p1" });
  expect(desk.propose).toHaveBeenCalledWith({
    order: {
      instrument: { ...TSMC, kind: InstrumentKind.Stock },
      side: Side.Buy,
      quantity: 1000,
      type: OrderType.Limit,
      limitPrice: 1000,
    },
    source: ProposalSource.Agent,
    rationale: "breakout above 1000",
  });

  await expect(
    run(AgentToolName.ProposeOrder, { order, rationale: "again" })
  ).rejects.toThrow("Only one proposal");
  expect(desk.propose).toHaveBeenCalledOnce();
});

test("skills are read by name", async () => {
  const { run } = setup();

  const { text } = await run(AgentToolName.ReadSkill, {
    name: "breakout-watch",
  });

  expect(text).toBe("# Breakout watch");
  await expect(run(AgentToolName.ReadSkill, { name: "nope" })).rejects.toThrow(
    "No skill"
  );
});
