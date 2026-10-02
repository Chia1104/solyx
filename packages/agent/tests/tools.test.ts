import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
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

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { SkillSource } from "../src/skill-source.ts";
import { createTradingExtension } from "../src/tools.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

/** What pi hands a tool after checking it against the JSON Schema. */
type ToolArguments = Parameters<ToolRegistration["execute"]>[0];

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

  const ports = {
    marketData: async (market: Market) =>
      market === Market.TW ? provider : undefined,
    watchlist: () => [TSMC],
    account: async () => ({ cash: { TWD: 1_000_000 }, positions: [] }),
    brokerMode: BrokerMode.Paper,
    desk,
    skills: async () => [
      {
        name: "breakout-watch",
        description: "Mine",
        body: "# Breakout watch",
        source: SkillSource.Solyx,
      },
    ],
    instructions: async () => "Risk at most 0.5% per trade.",
    now: () => NOW,
  };

  const tools = createTradingExtension(ports).tools ?? [];

  const run = async (name: AgentToolName, params: ToolArguments) => {
    const tool = tools.find((candidate) => candidate.name === name);

    if (!tool) throw new Error(`No tool ${name}`);

    // SAFETY: only propose_order uses its call's api, and it runs through a Harness below.
    const api = {} as ToolExecutionApi;
    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.content ?? []), details: result.details };
  };

  return { run, desk, ports, provider };
}

/** The agent on the trading tools, answering as `faux` scripts it. */
function agentOn(ports: ReturnType<typeof setup>["ports"]) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];

  models.setProvider(faux.provider);

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
    extensions: async () => ({
      offered: [createTradingExtension(ports)],
      deferred: [],
    }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  const ended = (count: number) =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(count)
    );

  return { faux, events, runtime, ended };
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
  const { desk, ports } = setup();
  const { faux, events, runtime, ended } = agentOn(ports);
  const { id } = await runtime.create();

  const propose = (callId: string) =>
    fauxToolCall(
      AgentToolName.ProposeOrder,
      { order, rationale: "breakout above 1000" },
      { id: callId }
    );

  faux.setResponses([
    // Two at once in one reply: only one may pass.
    fauxAssistantMessage([propose("a"), propose("b")], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("It waits for you."),
    fauxAssistantMessage(propose("c"), { stopReason: "toolUse" }),
    fauxAssistantMessage("Another one waits."),
  ]);

  await runtime.send(id, { text: "Buy 2330", context: "" });
  await ended(1);

  expect(desk.propose).toHaveBeenCalledOnce();
  expect(desk.propose).toHaveBeenCalledWith({
    id: expect.any(String),
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

  const calls = foldEvents(events).items.filter(
    (item) => item.kind === AgentItemKind.Tool
  );

  expect(calls.map((call) => call.status).toSorted()).toEqual([
    ToolCallStatus.Error,
    ToolCallStatus.Ok,
  ]);
  expect(calls).toContainEqual(
    expect.objectContaining({
      error: expect.stringContaining("Only one proposal"),
    })
  );

  // The next reply may propose again.
  await runtime.send(id, { text: "And another", context: "" });
  await ended(2);

  expect(desk.propose).toHaveBeenCalledTimes(2);

  await runtime.close();
});

test("the prompt carries the skills and the user's instructions", async () => {
  const { ports } = setup();
  const { faux, runtime, ended } = agentOn(ports);
  const { id } = await runtime.create();
  let seen = "";

  faux.setResponses([
    (context) => {
      seen = JSON.stringify(context.messages);

      return fauxAssistantMessage("ok");
    },
  ]);

  await runtime.send(id, { text: "hi", context: "" });
  await ended(1);

  expect(seen).toContain("breakout-watch");
  expect(seen).toContain("Risk at most 0.5% per trade.");
  expect(seen.indexOf("# Orders")).toBeLessThan(seen.indexOf("Risk at most"));

  await runtime.close();
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
