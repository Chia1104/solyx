import {
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { FauxResponseFactory, ToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision, readNews } from "@solyx/core/news";
import type { NewsDesk, NewsRecord } from "@solyx/core/news";
import type { OrderDesk } from "@solyx/core/order-desk";
import { weekdays } from "@solyx/core/session";
import { WebSearchKind } from "@solyx/core/web-search";
import type { WebReader, WebSearch } from "@solyx/core/web-search";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { createTradingExtension } from "../src/tools.ts";
import { createWebTools } from "../src/web.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ApprovalMode,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent, ToolCallView } from "../src/wire.ts";

// 2026-09-30 10:00 in Taipei.
const NOW = new Date("2026-09-30T02:00:00Z");

const FOUND = "https://www.ctee.com.tw/news/1";

const ELSEWHERE = "https://attacker.test/?positions=2330";

const NEWS_URL = "https://news.test/tsmc";

function fakeVendor() {
  return {
    search: vi.fn<WebSearch["search"]>(async () => [
      {
        url: FOUND,
        title: "台積電資本支出上修",
        snippet: "台積電今年資本支出可望達到新高",
        site: "ctee.com.tw",
        published: {
          at: new Date("2026-09-29T23:00:00Z"),
          precision: TimePrecision.Hour,
        },
      },
    ]),
    read: vi.fn<WebReader["read"]>(async (url) => ({
      url,
      title: "台積電資本支出上修",
      text: "全文",
    })),
  };
}

/** Collects one article about TSMC. */
function fakeNews(): Pick<NewsDesk, "collect"> {
  const record: NewsRecord = {
    source: "web-article",
    channel: NewsChannel.Article,
    item: {
      id: NEWS_URL,
      url: NEWS_URL,
      title: "TSMC raises its capital budget again",
      snippet: "",
      site: "news.test",
      published: null,
      votes: null,
    },
    foundAt: NOW,
    score: null,
  };

  return {
    collect: async (symbol) => ({
      ...readNews([record], { symbol, listing: null }),
      failures: [],
      scored: false,
    }),
  };
}

/** The agent with the web tools, and the trading tools for `get_news`, in a conversation set to `mode`. */
function setup(vendor = fakeVendor()) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  /** What each tool returned to the model, as the final request carried it. */
  const results: string[] = [];

  models.setProvider(faux.provider);

  const done: FauxResponseFactory = (context) => {
    for (const message of context.messages) {
      if (message.role === "toolResult") {
        results.push(contentText(message.content));
      }
    }

    return fauxAssistantMessage("Done.");
  };

  const trading = createTradingExtension({
    marketData: { candles: vi.fn(), listing: vi.fn(async () => null) },
    watchlist: () => [],
    news: fakeNews(),
    tradingDays: async () => weekdays,
    calendar: async () => ({
      events: [],
      research: [],
      unread: [],
      releases: [],
      unreadMarkets: [],
    }),
    desk: {
      check: vi.fn<OrderDesk["check"]>(async () => []),
      propose: vi.fn<OrderDesk["propose"]>(),
      list: () => [],
      account: async () => ({ cash: {}, positions: [] }),
      mode: BrokerMode.Paper,
    },
    skills: async () => [],
    instructions: async () => undefined,
    now: () => NOW,
  });

  const web = createWebTools({ vendor: async () => vendor, now: () => NOW });

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
    tools: async (guard) => ({
      offered: [trading, web.extension(guard)],
      deferred: [],
    }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  const calls = () =>
    foldEvents(events).items.filter(
      (item): item is ToolCallView & { kind: typeof AgentItemKind.Tool } =>
        item.kind === AgentItemKind.Tool
    );

  const ended = () =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(1)
    );

  /** Starts a run whose replies call each tool in turn, in a conversation set to `mode`. */
  async function start(
    mode: ApprovalMode,
    ...toolCalls: [AgentToolName, ToolCall["arguments"]][]
  ) {
    const { id } = await runtime.create();

    await runtime.setApprovalMode(id, mode);
    faux.setResponses([
      ...toolCalls.map(([name, args]) =>
        fauxAssistantMessage(fauxToolCall(name, args), {
          stopReason: "toolUse",
        })
      ),
      done,
    ]);

    await runtime.send(id, { text: "Look it up", context: "" });

    return id;
  }

  return { runtime, vendor, results, calls, ended, start };
}

test("searches through the vendor and lists each result with its site, time and address", async () => {
  const { runtime, vendor, results, calls, ended, start } = setup();

  await start(ApprovalMode.Ask, [
    AgentToolName.WebSearch,
    { query: "台積電 資本支出", kind: "news", days: 7, market: Market.TW },
  ]);
  await ended();

  expect(vendor.search).toHaveBeenCalledWith({
    text: "台積電 資本支出",
    kind: WebSearchKind.News,
    since: new Date("2026-09-23T02:00:00Z"),
    sites: [],
    market: Market.TW,
    limit: 10,
  });
  expect(calls()[0]).toMatchObject({ status: ToolCallStatus.Ok });
  expect(results[0]).toContain(
    `- ~2026-09-30 07:00 ctee.com.tw: 台積電資本支出上修\n  台積電今年資本支出可望達到新高\n  ${FOUND}`
  );

  await runtime.close();
});

test("in auto, a page the conversation's search or news found is read unasked, and any other address asks", async () => {
  const { runtime, vendor, calls, ended, start } = setup();

  const id = await start(
    ApprovalMode.Auto,
    [AgentToolName.WebSearch, { query: "台積電" }],
    [AgentToolName.GetNews, { symbol: { market: Market.TW, symbol: "2330" } }],
    [AgentToolName.ReadPage, { url: FOUND }],
    [AgentToolName.ReadPage, { url: NEWS_URL }],
    [AgentToolName.ReadPage, { url: ELSEWHERE }]
  );

  await vi.waitFor(() =>
    expect(calls()[4]).toMatchObject({
      status: ToolCallStatus.AwaitingApproval,
    })
  );

  runtime.approve(id, calls()[4].toolCallId, false);
  await ended();

  expect(calls().slice(2)).toMatchObject([
    { status: ToolCallStatus.Ok, autoApproved: true },
    { status: ToolCallStatus.Ok, autoApproved: true },
    { status: ToolCallStatus.Error },
  ]);
  expect(vendor.read.mock.calls).toEqual([[FOUND], [NEWS_URL]]);

  await runtime.close();
});

test("in ask, even a page the conversation found waits for the user", async () => {
  const { runtime, vendor, calls, ended, start } = setup();

  const id = await start(
    ApprovalMode.Ask,
    [AgentToolName.WebSearch, { query: "台積電" }],
    [AgentToolName.ReadPage, { url: FOUND }]
  );

  await vi.waitFor(() =>
    expect(calls()[1]).toMatchObject({
      status: ToolCallStatus.AwaitingApproval,
    })
  );

  runtime.approve(id, calls()[1].toolCallId, true);
  await ended();

  expect(calls()[1]).toMatchObject({ status: ToolCallStatus.Ok });
  expect(calls()[1]).not.toMatchObject({ autoApproved: true });
  expect(vendor.read).toHaveBeenCalledWith(FOUND);

  await runtime.close();
});
