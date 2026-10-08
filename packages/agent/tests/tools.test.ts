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

import { BrokerMode } from "@solyx/core/broker";
import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { MagiUnit, MagiVote, resolveCouncil } from "@solyx/core/council";
import { InstrumentKind, Market } from "@solyx/core/market";
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
import type { OrderDesk, TradeProposal } from "@solyx/core/order-desk";
import { RiskViolationCode } from "@solyx/core/risk";
import {
  Stance,
  TextKind,
  TextSpeaker,
  TextTopic,
} from "@solyx/core/sentiment";
import type { SentimentScore } from "@solyx/core/sentiment";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { SkillSource } from "../src/skill-source.ts";
import { createTradingExtension } from "../src/tools.ts";
import type { TradingToolPorts } from "../src/tools.ts";
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
    ...readNews(records, { symbol: TSMC, listing: null }),
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
    account: async () => ({ cash: { TWD: 1_000_000 }, positions: [] }),
    mode: BrokerMode.Paper,
  };

  const news = {
    collect: vi.fn<NewsDesk["collect"]>(async () => collection([])),
  };

  const ports = {
    marketData,
    watchlist: () => [TSMC],
    news,
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

    // SAFETY: only propose_order and get_news use their call's api, and both run through a Harness below.
    const api = {} as ToolExecutionApi;
    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.content ?? []), details: result.details };
  };

  return { run, desk, ports, marketData, news };
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
            at: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000),
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

test("indicators report the latest and previous values", async () => {
  const { run } = setup();

  const { text } = await run(AgentToolName.GetIndicators, {
    symbol: TSMC,
    interval: Interval.OneDay,
  });

  expect(text).toContain("close: 1079 (previous 1078)");
  expect(text).toContain("MA5: 1077 (previous 1076)");
  expect(text).toContain("MA10: 1074.5 (previous 1073.5)");
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
    magi: async () => async (motion: string) => {
      motions.push(motion);

      return verdicts[motions.length - 1];
    },
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
    magi: async () => convene,
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
    "Sentiment 80/100 with 50 neutral: press (announcements, articles) 80/100, crowd (forum, social) unscored",
    "Daily stance (n = stories about the listing; each scored story weighed by relevance, promotions left out): 2026-09-29 +0.60 (n=1), 2026-09-30 +0.60 (n=1)",
    "## article: 2 of 3",
    "- ~2026-09-30 05:00 news.test: 外資買超",
    "  stance +0.60, opinion, guidance, speaker outlet",
    "  外資買超 snippet",
    `  ${newsItem("外資買超", 5).url}`,
    "- ~2026-09-29 04:00 news.test: 法說前瞻",
    "  stance +0.60, opinion, guidance, speaker outlet",
    "  法說前瞻 snippet",
    `  ${newsItem("法說前瞻", 30).url}`,
  ]);
  expect(details).toEqual({ symbol: TSMC, stories: 3 });
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
    "Sentiment unscored with 50 neutral: press (announcements, articles) unscored, crowd (forum, social) unscored",
    "Daily stance (n = stories about the listing; each scored story weighed by relevance, promotions left out): 2026-09-28 unscored (n=1), 2026-09-30 unscored (n=1)",
    "## article: 2 of 2",
    "- undated news.test: 無日期",
    "  無日期 snippet",
    `  ${newsItem("無日期", null).url}`,
    "- 2026-09-28 news.test: 只知道日期",
    "  只知道日期 snippet",
    `  ${newsItem("只知道日期", null).url}`,
  ]);
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
    "Sentiment unscored with 50 neutral: press (announcements, articles) unscored, crowd (forum, social) unscored",
    "Daily stance (n = stories about the listing; each scored story weighed by relevance, promotions left out): 2026-09-30 unscored (n=1)",
    "## forum: 1 of 1",
    "- 2026-09-30 08:00 ptt.cc, votes +61, also told by 1 more (ptt.cc): [新聞] 台積電擬赴美設第二園區",
    "  https://www.ptt.cc/bbs/Stock/M.1.A.1.html",
    "Sources that failed this time: fake-social (Firecrawl returned 402; 1 failed in a row, never worked yet)",
  ]);
});
