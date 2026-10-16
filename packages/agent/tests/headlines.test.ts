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

import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type { Headline, NewsRecord } from "@solyx/core/news";
import { weekdays } from "@solyx/core/session";

import { createHeadlineTools } from "../src/headlines.ts";
import type { HeadlineToolsOptions } from "../src/headlines.ts";
import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { AgentEventType, AgentToolName } from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

// 2026-10-13 10:42 in Taipei, a Tuesday.
const NOW = new Date("2026-10-13T02:42:00Z");

const TSMC = { market: Market.TW, symbol: "2330" };

const ASE = { market: Market.TW, symbol: "3711" };

const HON_HAI = { market: Market.TW, symbol: "2317" };

function record(title: string, site: string, at: string): NewsRecord {
  return {
    source: "fake-news",
    channel: NewsChannel.Article,
    item: {
      id: title,
      url: `https://${site}/${encodeURIComponent(title)}`,
      title,
      snippet: `${title}的內文`,
      site,
      published: { at: new Date(at), precision: TimePrecision.Minute },
      votes: null,
    },
    foundAt: NOW,
    score: null,
  };
}

function headline(symbols: Headline["symbols"], ...records: NewsRecord[]) {
  return {
    story: { channel: NewsChannel.Article, lead: records[0], records },
    symbols,
    weight: 1,
  };
}

const HEADLINES: Headline[] = [
  headline(
    [TSMC, ASE],
    record("先進封裝產能明年翻倍", "news.test", "2026-10-12T09:30:00Z"),
    record("CoWoS 產能翻倍", "other.test", "2026-10-12T10:00:00Z")
  ),
  headline(
    [HON_HAI],
    record("鴻海九月營收創高", "news.test", "2026-10-13T01:00:00Z")
  ),
];

function setup(overrides: Partial<HeadlineToolsOptions> = {}) {
  // The host copies a story's lead apart from its records, so the lead is none of them as an object.
  const headlines = vi.fn<HeadlineToolsOptions["headlines"]>(async () =>
    HEADLINES.map((each) => ({
      ...each,
      story: {
        ...each.story,
        lead: { ...each.story.lead },
        records: each.story.records.map((record) => ({ ...record })),
      },
    }))
  );

  const options: HeadlineToolsOptions = {
    headlines,
    watchlist: () => [HON_HAI, TSMC],
    desk: {
      account: async () => ({
        cash: {},
        positions: [{ instrument: TSMC, quantity: 1000, avgPrice: 1000 }],
      }),
    },
    tradingDays: async () => weekdays,
    now: () => NOW,
    ...overrides,
  };

  return { headlines, options };
}

/** Runs get_headlines through the agent, since it notes the addresses it shows. */
async function read(
  options: HeadlineToolsOptions,
  args: ToolCall["arguments"]
) {
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
    fauxAssistantMessage(fauxToolCall(AgentToolName.GetHeadlines, args), {
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
    tools: async () => ({
      offered: [createHeadlineTools(options)],
      deferred: [],
    }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  const { id } = await runtime.create();

  await runtime.send(id, { text: "What is new?", context: "" });
  await vi.waitFor(() =>
    expect(
      events.filter((event) => event.type === AgentEventType.RunEnd)
    ).toHaveLength(1)
  );
  await runtime.close();

  return text;
}

test("reads the headlines of what the user holds and watches, each with the listings it is about", async () => {
  const { options, headlines } = setup();

  const text = await read(options, {});

  expect(headlines).toHaveBeenCalledWith(
    [TSMC, HON_HAI],
    new Date("2026-10-06T02:42:00Z"),
    15
  );
  expect(text.split("\n")).toEqual([
    "The 2 heaviest headlines about what the user holds and watches (TW 2330, TW 2317) over the last 7 days, heaviest first, as_of 2026-10-13 10:42 Taipei, from the news the app has kept; nothing was searched for",
    "About TW 2330, TW 3711:",
    "- 2026-10-12 17:30 (1 session since) news.test, also told by 1 more (other.test): 先進封裝產能明年翻倍",
    "  先進封裝產能明年翻倍的內文",
    "  https://news.test/%E5%85%88%E9%80%B2%E5%B0%81%E8%A3%9D%E7%94%A2%E8%83%BD%E6%98%8E%E5%B9%B4%E7%BF%BB%E5%80%8D",
    "About TW 2317:",
    "- 2026-10-13 09:00 (1 session since) news.test: 鴻海九月營收創高",
    "  鴻海九月營收創高的內文",
    "  https://news.test/%E9%B4%BB%E6%B5%B7%E4%B9%9D%E6%9C%88%E7%87%9F%E6%94%B6%E5%89%B5%E9%AB%98",
  ]);
});

test("reads the listings and the days a call names", async () => {
  const { options, headlines } = setup();

  const text = await read(options, { symbols: [ASE], days: 2 });

  expect(headlines).toHaveBeenCalledWith(
    [ASE],
    new Date("2026-10-11T02:42:00Z"),
    15
  );
  expect(text).toMatch(
    /^The 2 heaviest headlines about the listings asked for \(TW 3711\) over the last 2 days/
  );
});

test("says nothing was kept rather than that nothing happened", async () => {
  const { options } = setup({ headlines: async () => [] });

  expect(await read(options, {})).toBe(
    "No headlines: the app has kept no news about what the user holds and watches (TW 2330, TW 2317) over the last 7 days. Nothing was searched for; get_news collects one listing's news now."
  );
});

test("an account that cannot be read leaves the watchlist", async () => {
  const { options, headlines } = setup({
    desk: {
      account: async () => {
        throw new Error("Fubon did not answer");
      },
    },
  });

  const text = await read(options, {});

  expect(headlines.mock.calls[0][0]).toEqual([HON_HAI, TSMC]);
  expect(text.split("\n").at(-1)).toBe(
    "The account could not be read (Fubon did not answer), so only the watchlist was looked at."
  );
});

test("says so when the user follows nothing", async () => {
  const { options, headlines } = setup({
    watchlist: () => [],
    desk: { account: async () => ({ cash: {}, positions: [] }) },
  });

  expect(await read(options, {})).toBe(
    "No headlines: the user holds and watches no listing yet."
  );
  expect(headlines).not.toHaveBeenCalled();
});
