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

import { ForecastDirection } from "@solyx/core/forecast";
import type { Forecast } from "@solyx/core/forecast";
import { InstrumentKind, Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type { NewsDesk, NewsMatch } from "@solyx/core/news";
import { OrderType, Side } from "@solyx/core/order";
import { ProposalSource, ProposalStatus } from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";
import { ReportStance } from "@solyx/core/report";
import type { Report } from "@solyx/core/report";
import type { ResearchDesk } from "@solyx/core/research";

import { createHistory } from "../src/history.ts";
import type { HistoryOptions } from "../src/history.ts";
import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { AgentEventType, AgentToolName } from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const UMC = { market: Market.TW, symbol: "2303" };

const REPORT: Report = {
  symbol: TSMC,
  revision: 2,
  revisedAt: Date.parse("2026-08-14T10:00:00+08:00"),
  financialsThrough: "2026-06-30",
  stance: ReportStance.Bullish,
  thesis: "先進製程與先進封裝同步擴產，毛利率維持高檔。",
  drivers: [
    {
      point: "CoWoS 產能明年再翻倍，撐住 AI 營收。",
      text: "CoWoS capacity doubles in 2027.",
      source: "法說會",
      quote: "CoWoS capacity will double next year",
      support: null,
    },
  ],
  risks: [],
  falsifiers: ["毛利率連兩季跌破 53%。"],
  valuation: null,
  events: [],
  sections: {
    business: {
      text: "晶圓代工市占過半。先進封裝成為第二成長引擎。成熟製程價格承壓。",
      revisedAt: 0,
    },
  },
};

const FORECAST: Forecast = {
  id: "f-1",
  instrument: { ...TSMC, kind: InstrumentKind.Stock },
  horizon: 2,
  direction: ForecastDirection.Neutral,
  plan: null,
  scenarios: [
    {
      label: "Down",
      probability: 40,
      low: null,
      high: 1000,
      path: [{ session: 2, price: 980 }],
    },
    {
      label: "Up",
      probability: 60,
      low: 1000,
      high: null,
      path: [{ session: 2, price: 1030 }],
    },
  ],
  rationale: "CoWoS 擴產消息已反映。",
  claims: [],
  contrary: null,
  createdAt: 0,
  anchor: { date: "2026-09-29", price: 1000 },
  reportRevision: 2,
  council: null,
  outcome: null,
};

const NEWS: NewsMatch = {
  source: "firecrawl-news",
  channel: NewsChannel.Article,
  item: {
    id: "a",
    url: "https://news.test/cowos",
    title: "台積電 CoWoS 擴產",
    snippet: "供應鏈指出明年產能翻倍",
    site: "news.test",
    published: {
      at: new Date("2026-09-01T02:00:00Z"),
      precision: TimePrecision.Minute,
    },
    votes: null,
  },
  listings: [TSMC, UMC],
};

function proposal(
  id: string,
  symbol: string,
  rationale: string
): TradeProposal {
  return {
    id,
    order: {
      instrument: { market: Market.TW, symbol, kind: InstrumentKind.Stock },
      side: Side.Buy,
      quantity: 1000,
      type: OrderType.Limit,
      limitPrice: 1000,
    },
    source: ProposalSource.Agent,
    rationale,
    createdAt: Date.parse("2026-09-02T10:00:00+08:00"),
    status: ProposalStatus.Dismissed,
    violations: [],
  };
}

function setup() {
  const research = {
    search: vi.fn<ResearchDesk["search"]>(async () => ({
      reports: [{ report: REPORT, newest: 3 }],
      forecasts: [FORECAST],
    })),
  };

  const news = {
    search: vi.fn<NewsDesk["search"]>(async () => [
      NEWS,
      // Another source's copy of the headline.
      { ...NEWS, source: "web-article", item: { ...NEWS.item, id: "b" } },
    ]),
  };

  const proposals = [
    proposal("p-1", "2330", "CoWoS 擴產前布局。"),
    proposal("p-2", "2303", "成熟製程報價止跌。"),
  ];

  return {
    research,
    news,
    options: {
      research,
      news,
      desk: { list: () => proposals },
    } satisfies HistoryOptions,
  };
}

/** Runs search_history through the agent, since it notes the news addresses it shows. */
async function search(options: HistoryOptions, args: ToolCall["arguments"]) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  let text = "";

  models.setProvider(faux.provider);

  const done: FauxResponseFactory = (context) => {
    for (const message of context.messages) {
      if (message.role === "toolResult") text = contentText(message.content);
    }

    return fauxAssistantMessage("Done.");
  };

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall(AgentToolName.SearchHistory, args), {
      stopReason: "toolUse",
    }),
    done,
  ]);

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
    tools: async () => ({ offered: [createHistory(options)], deferred: [] }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  const { id } = await runtime.create();

  await runtime.send(id, { text: "Seen this before?", context: "" });
  await vi.waitFor(() =>
    expect(
      events.filter((event) => event.type === AgentEventType.RunEnd)
    ).toHaveLength(1)
  );
  await runtime.close();

  return text;
}

test("a search shows each kind best first, with the passages of a report that match", async () => {
  const { options, research, news } = setup();

  const text = await search(options, { query: "CoWoS 先進封裝" });

  expect(research.search).toHaveBeenCalledWith("CoWoS 先進封裝", 5, undefined);
  expect(news.search).toHaveBeenCalledWith("CoWoS 先進封裝", 20, undefined);
  expect(text.split("\n\n")).toEqual([
    [
      "Reports, best first:",
      "- TW 2330 report revision 2 (revision 3 is in force), revised 2026-08-14: bullish",
      "  thesis: 先進製程與先進封裝同步擴產，毛利率維持高檔。",
      "  driver: CoWoS 產能明年再翻倍，撐住 AI 營收。 Rests on: CoWoS capacity doubles in 2027.",
      "  business: 先進封裝成為第二成長引擎。",
    ].join("\n"),
    expect.stringMatching(
      /^Forecasts, best first:\n- f-1: TW 2330 neutral over 2 sessions/
    ),
    [
      "News, best first:",
      "- 2026-09-01 10:00 news.test (article, found for TW 2330, TW 2303): 台積電 CoWoS 擴產",
      "  供應鏈指出明年產能翻倍",
      "  https://news.test/cowos",
    ].join("\n"),
    expect.stringMatching(
      /^Proposals, best first:\n- p-1 \| .+\n {2}rationale: CoWoS 擴產前布局。$/
    ),
  ]);
});

test("a search keeps to the kinds and the listing asked for", async () => {
  const { options, research, news } = setup();

  const text = await search(options, {
    query: "成熟製程",
    kinds: ["proposal"],
    symbol: UMC,
  });

  expect(research.search).not.toHaveBeenCalled();
  expect(news.search).not.toHaveBeenCalled();
  expect(text).toMatch(/^Proposals, best first:\n- p-2 \|/);
  expect(text).not.toContain("p-1");
});

test("a kind with no match says so", async () => {
  const { options, research } = setup();

  research.search.mockResolvedValue({ reports: [], forecasts: [] });

  const text = await search(options, {
    query: "dividend",
    kinds: ["report", "forecast", "proposal"],
  });

  expect(text).toBe(
    [
      "Reports: nothing found.",
      "Forecasts: nothing found.",
      "Proposals: nothing found.",
    ].join("\n\n")
  );
});
