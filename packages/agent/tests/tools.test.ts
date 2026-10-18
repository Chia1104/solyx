import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { FauxResponseFactory, ToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { BrokerMode, BrokerOrderStatus } from "@solyx/core/broker";
import { EventTiming, ListingEventKind } from "@solyx/core/calendar";
import type { UpcomingEvents } from "@solyx/core/calendar";
import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { MagiUnit, MagiVote, resolveCouncil } from "@solyx/core/council";
import { ForecastDirection } from "@solyx/core/forecast";
import { MacroFigure, MacroIndicator, MacroUnit } from "@solyx/core/macro";
import { Market } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import { NewsChannel, TimePrecision, readNews } from "@solyx/core/news";
import type {
  NewsCollection,
  NewsDesk,
  NewsItem,
  NewsRecord,
} from "@solyx/core/news";
import { OrderType, Side } from "@solyx/core/order";
import { ProposalSource, ProposalStatus } from "@solyx/core/order-desk";
import type {
  OrderDesk,
  ProposalBasis,
  TradeProposal,
} from "@solyx/core/order-desk";
import { ReportStance } from "@solyx/core/report";
import { RiskViolationCode } from "@solyx/core/risk";
import {
  Stance,
  TextKind,
  TextSpeaker,
  TextTopic,
} from "@solyx/core/sentiment";
import type { SentimentScore } from "@solyx/core/sentiment";
import { listedTradingDays, weekdays } from "@solyx/core/session";
import { HOUR_MS } from "@solyx/utils/date";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { SkillSource } from "../src/skill-source.ts";
import { createTradingExtension, describeProposal } from "../src/tools.ts";
import type { TradingToolPorts } from "../src/tools.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

import { LINKS } from "./fixtures/links.ts";

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

function newsRecord(
  item: NewsItem,
  score: SentimentScore | null = null,
  channel: NewsChannel = NewsChannel.Article
): NewsRecord {
  return { source: "fake-news", channel, item, foundAt: NOW, score };
}

/** What the news desk hands back for `records`, as it groups and orders them. */
function collection(
  records: NewsRecord[],
  overrides: Partial<NewsCollection> = {}
): NewsCollection {
  return {
    ...readNews(records, { symbol: TSMC, listing: null }, NOW),
    failures: [],
    scored: true,
    ...overrides,
  };
}

function setup(candles: Candle[] = dailyBars(80)) {
  const marketData = {
    candles: vi.fn<MarketData["candles"]>(async () => candles),
    listing: vi.fn<MarketData["listing"]>(async () => null),
  };

  const proposal = (overrides: Partial<TradeProposal>): TradeProposal => ({
    id: "p1",
    broker: "paper",
    order: {
      instrument: TSMC,
      side: Side.Buy,
      quantity: 1000,
      type: OrderType.Limit,
      limitPrice: 1000,
    },
    source: ProposalSource.Agent,
    rationale: "breakout",
    basis: null,
    premise: null,
    createdAt: NOW.getTime(),
    status: ProposalStatus.AwaitingConfirmation,
    violations: [],
    ...overrides,
  });

  const desk = {
    check: vi.fn<OrderDesk["check"]>(async () => []),
    propose: vi.fn<OrderDesk["propose"]>(async () => proposal({})),
    list: vi.fn<OrderDesk["list"]>(() => []),
    account: vi.fn<OrderDesk["account"]>(async () => ({
      cash: { TWD: 1_000_000 },
      positions: [],
    })),
    fills: vi.fn<OrderDesk["fills"]>(async () => []),
    working: vi.fn<OrderDesk["working"]>(async () => []),
    mode: BrokerMode.Paper,
  };

  const news = {
    collect: vi.fn<NewsDesk["collect"]>(async () => collection([])),
  };

  const tradingDays = vi.fn<TradingToolPorts["tradingDays"]>(
    async () => weekdays
  );

  const calendar = vi.fn<TradingToolPorts["calendar"]>(
    async (): Promise<UpcomingEvents> => ({
      events: [],
      research: [],
      unread: [],
      releases: [],
      closures: [],
      unreadMarkets: [],
    })
  );

  const figures = vi.fn<TradingToolPorts["figures"]>(async () => []);

  const ports = {
    marketData,
    watchlist: () => [TSMC],
    news,
    tradingDays,
    calendar,
    figures,
    desk,
    links: LINKS,
    skills: async () => [
      {
        name: "breakout-watch",
        description: "Mine",
        body: "# Breakout watch",
        source: SkillSource.Solyx,
        userInvocable: true,
      },
    ],
    instructions: async () => "Risk at most 0.5% per trade.",
    now: () => NOW,
  };

  const tools = createTradingExtension(ports).tools ?? [];

  const run = async (name: AgentToolName, params: ToolArguments) => {
    const tool = tools.find((candidate) => candidate.name === name);

    if (!tool) throw new Error(`No tool ${name}`);

    // SAFETY: only propose_order and get_news use their call's api, and both run through a Harness below.
    const api = {} as ToolExecutionApi;
    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.output ?? []), details: result.details };
  };

  return {
    run,
    desk,
    ports,
    marketData,
    news,
    tradingDays,
    calendar,
    figures,
  };
}

function newsItem(title: string, hoursAgo: number | null): NewsItem {
  return {
    id: title,
    url: `https://news.test/${encodeURIComponent(title)}`,
    title,
    snippet: `${title} snippet`,
    site: "news.test",
    // Ages from a search engine, so only to about the hour.
    published:
      hoursAgo === null
        ? null
        : {
            at: new Date(NOW.getTime() - hoursAgo * HOUR_MS),
            precision: TimePrecision.Hour,
          },
    votes: null,
  };
}

function sentiment(relevance: number, positive: number): SentimentScore {
  return {
    model: "jev-1.13.0",
    relevance,
    stance: {
      [Stance.Negative]: 0,
      [Stance.LeanNegative]: 0,
      [Stance.Neutral]: 1 - positive,
      [Stance.LeanPositive]: 0,
      [Stance.Positive]: positive,
    },
    kind: {
      [TextKind.Report]: 0.2,
      [TextKind.Opinion]: 0.7,
      [TextKind.Promotion]: 0.1,
    },
    topic: {
      [TextTopic.Earnings]: 0,
      [TextTopic.Guidance]: 0.8,
      [TextTopic.Business]: 0.2,
      [TextTopic.Capital]: 0,
      [TextTopic.Analyst]: 0,
      [TextTopic.Legal]: 0,
      [TextTopic.Market]: 0,
      [TextTopic.Other]: 0,
    },
    speaker: {
      [TextSpeaker.Company]: 0,
      [TextSpeaker.Outlet]: 0.9,
      [TextSpeaker.Investor]: 0.1,
      [TextSpeaker.Reference]: 0,
      [TextSpeaker.Other]: 0,
    },
  };
}

/** The agent on the trading tools, answering as `faux` scripts it. */
function agentOn(ports: TradingToolPorts) {
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
    tools: async () => ({
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

/** Runs get_news through the agent, since it notes the addresses it shows in the conversation. */
async function getNews(
  ports: ReturnType<typeof setup>["ports"],
  args: ToolCall["arguments"]
) {
  const { faux, events, runtime, ended } = agentOn(ports);
  let text = "";

  const done: FauxResponseFactory = (context) => {
    for (const message of context.messages) {
      if (message.role === "toolResult") text = contentText(message.content);
    }

    return fauxAssistantMessage("Done.");
  };

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall(AgentToolName.GetNews, args), {
      stopReason: "toolUse",
    }),
    done,
  ]);

  const { id } = await runtime.create();

  await runtime.send(id, { text: "Any news?", context: "" });
  await ended(1);
  await runtime.close();

  const call = foldEvents(events).items.find(
    (item) => item.kind === AgentItemKind.Tool
  );

  return {
    text,
    details: call?.kind === AgentItemKind.Tool ? call.details : undefined,
  };
}

const order = {
  market: Market.TW,
  symbol: "2330",
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

test("indicators report the latest and previous values", async () => {
  const { run } = setup();

  const { text } = await run(AgentToolName.GetIndicators, {
    symbol: TSMC,
    interval: Interval.OneDay,
  });

  expect(text).toContain("close: 1079 (previous 1078)");
  expect(text).toContain("MA5: 1077 (previous 1076)");
  expect(text).toContain("MA10: 1074.5 (previous 1073.5)");
  expect(text).toContain("52-week range: 996-1082");
  expect(text).toMatch(/support zones: .*MA60 1028\.51-1070\.49/);
});

test("indicators measure a daily listing against the market's index", async () => {
  const { run, marketData } = setup();
  const flatIndex = dailyBars(80).map((bar) => ({ ...bar, close: 20_000 }));

  marketData.candles.mockImplementation(async (symbol) =>
    symbol.symbol === "IX0001" ? flatIndex : dailyBars(80)
  );

  const { text } = await run(AgentToolName.GetIndicators, {
    symbol: TSMC,
    interval: Interval.OneDay,
  });

  // Against a flat index, strength is the listing's own return: 1079 from 1059 and from 1019.
  expect(text).toContain(
    "relative strength vs TAIEX, percentage points: 20 sessions +1.89, 60 sessions +5.89, 120 sessions n/a"
  );
});

test("indicators read an intraday session's VWAP, the session before and the opening range", async () => {
  const at = (date: string, time: string) =>
    Date.parse(`${date}T${time}:00+08:00`) / 1000;

  const bar = (time: number, close: number, volume: number): Candle => ({
    time,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume,
  });

  const { run } = setup([
    bar(at("2026-09-28", "09:00"), 1000, 10),
    bar(at("2026-09-28", "13:25"), 1010, 10),
    bar(at("2026-09-29", "09:00"), 1020, 10),
    bar(at("2026-09-29", "09:25"), 1030, 30),
    bar(at("2026-09-29", "09:30"), 1040, 10),
  ]);

  const { text } = await run(AgentToolName.GetIndicators, {
    symbol: TSMC,
    interval: Interval.FiveMinutes,
  });

  expect(text).toContain("VWAP: 1030 (previous 1027.5)");
  expect(text).toContain("previous session: high 1011, low 999, close 1010");
  expect(text).toContain("opening range: 1019-1031");
});

test("indicators leave the daily levels out of intraday bars", async () => {
  const { run } = setup();

  const { text } = await run(AgentToolName.GetIndicators, {
    symbol: TSMC,
    interval: Interval.FiveMinutes,
  });

  expect(text).not.toContain("52-week range");
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

test("the account tells how its closed round trips went by the stance they were opened under", async () => {
  const { run, desk } = setup();
  const tsmc = { market: Market.TW, symbol: "2330" };

  const fill = (
    orderId: string,
    side: Side,
    filledAt: number,
    realized: number | null
  ) => ({
    orderId,
    instrument: tsmc,
    side,
    quantity: 1000,
    price: 1000,
    filledAt,
    realized,
  });

  desk.fills.mockResolvedValueOnce([
    fill("B-1", Side.Buy, 1, null),
    fill("B-2", Side.Sell, 2, 20_000),
    fill("B-3", Side.Buy, 3, null),
    fill("B-4", Side.Sell, 4, -10_000),
  ]);

  desk.list.mockReturnValueOnce([
    {
      id: "p1",
      broker: "paper",
      order: {
        instrument: tsmc,
        side: Side.Buy,
        quantity: 1000,
        type: OrderType.Limit,
        limitPrice: 1000,
      },
      source: ProposalSource.Agent,
      rationale: "breakout",
      basis: {
        report: { revision: 1, revisedAt: 0, stance: ReportStance.Bullish },
        forecast: null,
      },
      premise: null,
      createdAt: 0,
      status: ProposalStatus.Submitted,
      violations: [],
      brokerOrderId: "B-1",
    },
  ]);

  const { text } = await run(AgentToolName.GetAccount, {});

  expect(text).toContain(
    "- TWD all: 2 trips, 1 won (50.0%), average win +20000, average loss -10000, payoff ratio 2, realized +10000"
  );
  expect(text).toContain("- TWD bullish: 1 trips, 1 won (100.0%)");
  expect(text).toContain("- TWD no report: 1 trips, 0 won (0.0%)");
  expect(text).toContain("working orders:\nnone");
  expect(desk.fills).toHaveBeenCalledWith(0);
});

test("the account names each order of the day that may still fill", async () => {
  const { run, desk } = setup();

  desk.working.mockResolvedValueOnce([
    {
      id: "B-7",
      tag: null,
      order: {
        instrument: TSMC,
        side: Side.Sell,
        quantity: 2000,
        type: OrderType.Limit,
        limitPrice: 1010,
      },
      filled: 1000,
      status: BrokerOrderStatus.Working,
      placedAt: NOW.getTime(),
    },
  ]);

  const { text } = await run(AgentToolName.GetAccount, {});

  expect(text).toContain(
    "working orders:\nB-7 TW 2330 sell 2000 shares limit 1010, 1000 filled, working"
  );
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

test("a proposal names the research it was made under, as the desk kept it", () => {
  const made = (basis: ProposalBasis | null): TradeProposal => ({
    id: "p1",
    broker: "paper",
    order: {
      instrument: TSMC,
      side: Side.Buy,
      quantity: 1000,
      type: OrderType.Limit,
      limitPrice: 1000,
    },
    source: ProposalSource.User,
    rationale: "",
    basis,
    premise: null,
    createdAt: NOW.getTime(),
    status: ProposalStatus.AwaitingConfirmation,
    violations: [],
  });

  const report = {
    revision: 3,
    revisedAt: Date.parse("2026-09-28T09:00:00+08:00"),
    stance: ReportStance.Bullish,
  };

  expect(
    describeProposal(
      made({
        report,
        forecast: {
          id: "f-1",
          createdAt: Date.parse("2026-09-29T14:00:00+08:00"),
          direction: ForecastDirection.Long,
          horizon: 5,
        },
      })
    )
  ).toMatch(
    / \| made under report revision 3 \(bullish, revised 2026-09-28\) and its forecast f-1 \(long over 5 sessions, made 2026-09-29\)$/
  );
  expect(describeProposal(made({ report, forecast: null }))).toMatch(
    /revised 2026-09-28\), with no forecast under it$/
  );
  expect(describeProposal(made({ report: null, forecast: null }))).toMatch(
    / \| made with no report on the listing$/
  );
  expect(describeProposal(made(null))).not.toContain("made ");
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
      instrument: TSMC,
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

test("under the MAGI a rejected proposal is never made, and a carried one keeps its votes", async () => {
  const { desk, ports } = setup();
  const motions: string[] = [];

  const verdicts = [
    [MagiVote.Approve, MagiVote.Reject, MagiVote.Reject],
    [MagiVote.Approve, MagiVote.Approve, MagiVote.Reject],
  ].map((cast) =>
    resolveCouncil(
      Object.values(MagiUnit).map((unit, index) => ({
        unit,
        vote: cast[index],
        reason: `${unit} has its reason.`,
        model: "faux",
      }))
    )
  );

  const [rejected, carried] = verdicts;

  const { faux, events, runtime, ended } = agentOn({
    ...ports,
    magi: async () => ({
      motion: async (motion) => {
        motions.push(motion);

        return verdicts[motions.length - 1];
      },
      scenarios: vi.fn(),
    }),
  });

  const { id } = await runtime.create();

  const propose = () =>
    fauxAssistantMessage(
      fauxToolCall(AgentToolName.ProposeOrder, {
        order,
        rationale: "breakout above 1000",
      }),
      { stopReason: "toolUse" }
    );

  faux.setResponses([
    propose(),
    fauxAssistantMessage("The MAGI rejected it."),
    propose(),
    fauxAssistantMessage("It waits for you."),
  ]);

  await runtime.send(id, { text: "Buy 2330", context: "" });
  await ended(1);

  expect(desk.propose).not.toHaveBeenCalled();
  expect(motions[0]).toContain(
    "put before the user an order to buy 1000 shares of TW:2330 at 1000"
  );

  await runtime.send(id, { text: "Try again", context: "" });
  await ended(2);

  expect(desk.propose).toHaveBeenCalledOnce();

  const calls = foldEvents(events).items.filter(
    (item) => item.kind === AgentItemKind.Tool
  );

  // A rejection is the vote's answer, not a failed call.
  expect(calls.map((call) => call.status)).toEqual([
    ToolCallStatus.Ok,
    ToolCallStatus.Ok,
  ]);
  expect(calls.map((call) => call.details)).toEqual([
    { council: rejected },
    { proposalId: "p1", council: carried },
  ]);

  await runtime.close();
});

test("under the MAGI an order the checks refuse goes to the desk without a vote", async () => {
  const { desk, ports } = setup();
  const convene = vi.fn();

  desk.check.mockResolvedValue([
    { code: RiskViolationCode.MissingReferencePrice },
  ]);

  const { faux, runtime, ended } = agentOn({
    ...ports,
    magi: async () => ({ motion: convene, scenarios: vi.fn() }),
  });

  const { id } = await runtime.create();

  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall(AgentToolName.ProposeOrder, {
        order,
        rationale: "breakout above 1000",
      }),
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage("The checks refused it."),
  ]);

  await runtime.send(id, { text: "Buy 2330", context: "" });
  await ended(1);

  expect(convene).not.toHaveBeenCalled();
  expect(desk.propose).toHaveBeenCalledOnce();

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

test("the calendar lists the followed listings' events and their markets' releases, deadlines marked", async () => {
  const { run, desk, calendar, figures } = setup();

  desk.account.mockResolvedValue({
    cash: { TWD: 1_000_000 },
    positions: [
      {
        instrument: {
          market: Market.TW,
          symbol: "6669",
        },
        quantity: 1000,
        avgPrice: 2200,
      },
    ],
  });

  calendar.mockResolvedValue({
    events: [
      {
        symbol: TSMC,
        kind: ListingEventKind.DividendPayment,
        date: "2026-10-08",
        timing: EventTiming.Set,
        subject: "115年第1季",
        amount: 7,
        until: null,
      },
      {
        symbol: { market: Market.TW, symbol: "6669" },
        kind: ListingEventKind.MonthlyRevenue,
        date: "2026-10-10",
        timing: EventTiming.Deadline,
        subject: "2026-09",
        amount: null,
        until: null,
      },
      {
        symbol: { market: Market.TW, symbol: "6669" },
        kind: ListingEventKind.ShortSaleSuspension,
        date: "2026-10-12",
        timing: EventTiming.Set,
        subject: "除息",
        amount: null,
        until: "2026-10-15",
      },
      // Told of only by the exchange's notice, before any amount is set.
      {
        symbol: { market: Market.TW, symbol: "6669" },
        kind: ListingEventKind.ExDividend,
        date: "2026-10-14",
        timing: EventTiming.Set,
        subject: "",
        amount: null,
        until: null,
      },
      {
        symbol: TSMC,
        kind: ListingEventKind.ExDividend,
        date: "2026-10-15",
        timing: EventTiming.Set,
        subject: "",
        amount: 7.5,
        until: null,
      },
      {
        symbol: TSMC,
        kind: ListingEventKind.ExRights,
        date: "2026-10-15",
        timing: EventTiming.Set,
        subject: "",
        amount: null,
        until: null,
      },
      {
        symbol: TSMC,
        kind: ListingEventKind.SpecialMeeting,
        date: "2026-10-20",
        timing: EventTiming.Set,
        subject: "",
        amount: null,
        until: null,
      },
      {
        symbol: TSMC,
        kind: ListingEventKind.DirectorElection,
        date: "2026-10-20",
        timing: EventTiming.Set,
        subject: "",
        amount: null,
        until: null,
      },
    ],
    research: [
      {
        symbol: TSMC,
        date: "2026-10-16",
        label: "Third-quarter earnings call",
        timing: EventTiming.Set,
        source: "https://investor.test/calendar",
        quote: "3Q26 Earnings Conference: October 16, 2026",
      },
      {
        symbol: TSMC,
        date: "2026-10-28",
        label: "Export rule decision",
        timing: EventTiming.Expected,
        source: "news.test",
        quote: "A decision is expected in late October.",
      },
    ],
    unread: [{ market: Market.TW, symbol: "6669" }],
    releases: [
      {
        market: Market.TW,
        indicator: MacroIndicator.Trade,
        date: "2026-10-08",
        time: "16:00",
        timing: EventTiming.Set,
        period: "2026-09",
        page: "https://www.mof.gov.tw/multiplehtml/384",
      },
      {
        market: Market.TW,
        indicator: MacroIndicator.ConsumerPrices,
        date: "2026-11-05",
        time: "16:00",
        timing: EventTiming.Set,
        period: "2026-10",
        page: null,
      },
      {
        market: Market.TW,
        indicator: MacroIndicator.BusinessSignal,
        date: "2026-10-28",
        time: "16:00",
        timing: EventTiming.Set,
        period: "2026-09",
        page: null,
      },
      {
        market: Market.TW,
        indicator: MacroIndicator.PurchasingManagers,
        date: "2026-11-03",
        time: null,
        timing: EventTiming.Deadline,
        period: "2026-10",
        page: null,
      },
    ],
    closures: [{ market: Market.TW, date: "2026-10-09", name: "國慶日" }],
    unreadMarkets: [],
  });

  figures.mockResolvedValue([
    {
      market: Market.TW,
      indicator: MacroIndicator.Trade,
      figure: MacroFigure.Exports,
      unit: MacroUnit.UsdMillions,
      observations: [
        { period: "2025-09", value: 41000 },
        { period: "2026-08", value: 50000 },
        { period: "2026-09", value: 52000 },
      ],
    },
    {
      market: Market.TW,
      indicator: MacroIndicator.Trade,
      figure: MacroFigure.Imports,
      unit: MacroUnit.UsdMillions,
      observations: [
        { period: "2026-08", value: 36000 },
        { period: "2026-09", value: 38000.5 },
      ],
    },
    {
      market: Market.TW,
      indicator: MacroIndicator.ConsumerPrices,
      figure: MacroFigure.ConsumerPrices,
      unit: MacroUnit.Index,
      observations: [
        { period: "2025-09", value: 100 },
        { period: "2026-08", value: 102 },
        { period: "2026-09", value: 102.5 },
      ],
    },
    {
      market: Market.TW,
      indicator: MacroIndicator.BusinessSignal,
      figure: MacroFigure.BusinessSignal,
      unit: MacroUnit.Points,
      observations: [
        { period: "2026-07", value: 40 },
        { period: "2026-08", value: 41 },
      ],
    },
  ]);

  const { text, details } = await run(AgentToolName.GetCalendar, { days: 30 });

  expect(calendar).toHaveBeenCalledWith(
    [{ market: Market.TW, symbol: "6669" }, TSMC],
    30
  );
  expect(figures).toHaveBeenCalledWith(Market.TW);
  expect(text.split("\n")).toEqual([
    "Calendar of TW 6669, TW 2330 over the next 30 days, each market from its own day today, as_of 2026-09-30 10:00 Taipei; the same list the app's overview shows",
    "Listings' filings, distributions, meetings and restrictions:",
    "2026-10-08 TW 2330 pays its dividend, 7 cash a share (115年第1季)",
    "by 2026-10-10 TW 6669 2026-09 revenue due",
    "2026-10-12 TW 6669 short sale suspension until 2026-10-15 (除息)",
    "2026-10-14 TW 6669 goes ex-dividend by its exchange's notice, the amount not announced yet",
    "2026-10-15 TW 2330 goes ex-dividend, 7.5 cash a share",
    "2026-10-15 TW 2330 goes ex-rights by its exchange's notice, which may be a stock dividend or the right to subscribe to new shares",
    "2026-10-20 TW 2330 holds a special shareholders' meeting",
    "2026-10-20 TW 2330 elects directors at its shareholders' meeting",
    "Dates their reports hold, each as you found it, with its source:",
    "2026-10-16 TW 2330 Third-quarter earnings call [https://investor.test/calendar]",
    "around 2026-10-28 TW 2330 Export rule decision [news.test]",
    "Economic releases of their markets, from 7 days back:",
    "2026-10-08 16:00 TW trade for 2026-09 [https://www.mof.gov.tw/multiplehtml/384]; out: exports USD 52000 million, +26.83% on the year; imports USD 38000.5 million, n/a on the year",
    "2026-11-05 16:00 TW consumer prices for 2026-10; last out, for 2026-09: consumer prices +2.50% on the year (index 102.5)",
    "2026-10-28 16:00 TW business signal for 2026-09; last out, for 2026-08: business signal 41 points, 40 the period before",
    "by 2026-11-03 TW purchasing managers for 2026-10",
    "Weekdays their markets are closed:",
    "2026-10-09 TW closed (國慶日)",
    "Could not read the fundamentals of TW 6669 this time, so dates may be missing.",
  ]);
  expect(details).toEqual({
    symbols: [{ market: Market.TW, symbol: "6669" }, TSMC],
    days: 30,
    events: 10,
    releases: 4,
  });
});

test("the calendar names a market whose figures cannot be read, and lists its releases without any", async () => {
  const { run, calendar, figures } = setup();

  calendar.mockResolvedValue({
    events: [],
    research: [],
    unread: [],
    releases: [
      {
        market: Market.TW,
        indicator: MacroIndicator.ConsumerPrices,
        date: "2026-11-05",
        time: "16:00",
        timing: EventTiming.Set,
        period: "2026-10",
        page: null,
      },
    ],
    closures: [],
    unreadMarkets: [],
  });
  figures.mockRejectedValue(new Error("DGBAS: Request timed out"));

  const { text } = await run(AgentToolName.GetCalendar, { days: 30 });

  expect(text).toContain("2026-11-05 16:00 TW consumer prices for 2026-10\n");
  expect(text).toContain(
    "Could not read the economic figures of TW this time, so dates may be missing."
  );
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

test("news reads newest first, leaving out stories that only name the listing", async () => {
  const { ports, news } = setup();

  news.collect.mockResolvedValue(
    collection([
      newsRecord(newsItem("法說前瞻", 30), sentiment(0.9, 0.6)),
      newsRecord(newsItem("大盤收紅", 2), sentiment(0.2, 0)),
      newsRecord(newsItem("外資買超", 5), sentiment(0.9, 0.6)),
    ])
  );

  const { text, details } = await getNews(ports, { symbol: TSMC, days: 3 });

  expect(news.collect).toHaveBeenCalledWith(
    TSMC,
    new Date("2026-09-27T02:00:00Z"),
    10
  );
  expect(text.split("\n")).toEqual([
    "TW 2330 news and posts over the last 3 days, as_of 2026-09-30 10:00, scored by jev-1.13.0",
    "Sentiment, 50 neutral: overall 80/100; press (announcements, articles) 80/100; crowd (forum, social) unscored",
    "Daily stance (n = stories about the listing; each scored story weighed by relevance, promotions left out): 2026-09-29 +0.60 (n=1), 2026-09-30 +0.60 (n=1)",
    "## article: 2 of 3",
    "- ~2026-09-30 05:00 (1 session since) news.test: 外資買超",
    "  stance +0.60, opinion, guidance, speaker outlet",
    "  外資買超 snippet",
    `  ${newsItem("外資買超", 5).url}`,
    "- ~2026-09-29 04:00 (2 sessions since) news.test: 法說前瞻",
    "  stance +0.60, opinion, guidance, speaker outlet",
    "  法說前瞻 snippet",
    `  ${newsItem("法說前瞻", 30).url}`,
  ]);
  expect(details).toEqual({ symbol: TSMC, stories: 3 });
});

test("a sentiment resting on too little recent news reads as stale, with its newest story", async () => {
  const { ports, news } = setup();

  news.collect.mockResolvedValue(
    collection([newsRecord(newsItem("法說前瞻", 72), sentiment(0.9, 0.6))])
  );

  const { text } = await getNews(ports, { symbol: TSMC });

  expect(text.split("\n")[1]).toBe(
    "Sentiment, 50 neutral: overall 80/100 stale, newest 2026-09-27 10:00; press (announcements, articles) 80/100 stale, newest 2026-09-27 10:00; crowd (forum, social) unscored"
  );
});

test("without a decisions model, news is listed unscored", async () => {
  const { ports, news } = setup();

  news.collect.mockResolvedValue(
    collection(
      [
        newsRecord(newsItem("無日期", null)),
        newsRecord({
          ...newsItem("只知道日期", null),
          published: {
            at: new Date("2026-09-27T16:00:00Z"),
            precision: TimePrecision.Day,
          },
        }),
      ],
      { scored: false }
    )
  );

  const { text } = await getNews(ports, { symbol: TSMC });

  expect(text.split("\n")).toEqual([
    "TW 2330 news and posts over the last 7 days, as_of 2026-09-30 10:00; not scored, since the user has not set up a decisions model",
    "Sentiment, 50 neutral: overall unscored; press (announcements, articles) unscored; crowd (forum, social) unscored",
    "Daily stance (n = stories about the listing; each scored story weighed by relevance, promotions left out): 2026-09-28 unscored (n=1), 2026-09-30 unscored (n=1)",
    "## article: 2 of 2",
    "- undated news.test: 無日期",
    "  無日期 snippet",
    `  ${newsItem("無日期", null).url}`,
    "- 2026-09-28 (2 sessions after that day) news.test: 只知道日期",
    "  只知道日期 snippet",
    `  ${newsItem("只知道日期", null).url}`,
  ]);
});

test("sessions since a story leave out the exchange's holidays, or count every weekday when they cannot be read", async () => {
  const { ports, news, tradingDays } = setup();

  news.collect.mockResolvedValue(
    collection([newsRecord(newsItem("法說前瞻", 30), null)], { scored: false })
  );

  // Tuesday 2026-09-29 is a holiday.
  tradingDays.mockResolvedValueOnce(
    listedTradingDays("2026-09-28", ["2026-09-28", "2026-09-30"])
  );

  const holiday = await getNews(ports, { symbol: TSMC });

  expect(tradingDays).toHaveBeenCalledWith(Market.TW);
  expect(holiday.text).toContain(
    "- ~2026-09-29 04:00 (1 session since) news.test: 法說前瞻"
  );

  tradingDays.mockRejectedValueOnce(new Error("FinMind answered 402"));

  const unread = (await getNews(ports, { symbol: TSMC })).text.split("\n");

  expect(unread).toContain(
    "- ~2026-09-29 04:00 (2 sessions since) news.test: 法說前瞻"
  );
  expect(unread.at(-1)).toBe(
    "The exchange's trading days could not be read (FinMind answered 402), so every weekday counted as a session."
  );
});

test("channels get sections, a thread is one story, and a failed source says how it has gone", async () => {
  const { ports, news } = setup();

  const post = (id: string, title: string, hour: string, votes: number) => ({
    id,
    url: `https://www.ptt.cc/bbs/Stock/${id}.html`,
    title,
    snippet: "",
    site: "ptt.cc",
    published: {
      at: new Date(`2026-09-30T${hour}:00:00Z`),
      precision: TimePrecision.Minute,
    },
    votes,
  });

  news.collect.mockResolvedValue(
    collection(
      [
        newsRecord(
          post("M.1.A.1", "[新聞] 台積電擬赴美設第二園區", "00", 61),
          null,
          NewsChannel.Forum
        ),
        newsRecord(
          post("M.2.A.2", "Re: [新聞] 台積電擬赴美設第二園區", "01", 3),
          null,
          NewsChannel.Forum
        ),
      ],
      {
        scored: false,
        failures: [
          {
            source: "fake-social",
            lastSuccessAt: null,
            lastFailureAt: NOW,
            failureStreak: 1,
            lastError: "Firecrawl returned 402",
          },
        ],
      }
    )
  );

  const { text } = await getNews(ports, { symbol: TSMC });

  expect(text.split("\n")).toEqual([
    "TW 2330 news and posts over the last 7 days, as_of 2026-09-30 10:00; not scored, since the user has not set up a decisions model",
    "Sentiment, 50 neutral: overall unscored; press (announcements, articles) unscored; crowd (forum, social) unscored",
    "Daily stance (n = stories about the listing; each scored story weighed by relevance, promotions left out): 2026-09-30 unscored (n=1)",
    "## forum: 1 of 1",
    "- 2026-09-30 08:00 (1 session since) ptt.cc, votes +61, also told by 1 more (ptt.cc): [新聞] 台積電擬赴美設第二園區",
    "  https://www.ptt.cc/bbs/Stock/M.1.A.1.html",
    "Sources that failed this time: fake-social (Firecrawl returned 402; 1 failed in a row, never worked yet)",
  ]);
});

test("the market status reads a market as closed all day on a day its exchange does not trade", async () => {
  const { run, tradingDays } = setup();

  // NOW is mid-session in Taipei on a weekday.
  expect((await run(AgentToolName.GetMarketStatus, {})).text).toContain(
    "TW: regular"
  );

  tradingDays.mockResolvedValue(() => false);

  expect((await run(AgentToolName.GetMarketStatus, {})).text).toContain(
    "TW: closed"
  );
});
