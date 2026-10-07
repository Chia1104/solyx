import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import { WebSearchKind } from "@solyx/core/web-search";

import { createTavily } from "../src/tavily.ts";

// 2026-09-27 01:00 in Taipei, still the 26th in UTC and New York.
const SINCE = new Date("2026-09-26T17:00:00Z");

interface Sent {
  url: string;
  authorization: string | null;
  body: unknown;
}

/** Answers each request with the next body, as JSON with the status given beside it. */
function fakeTavily(...answers: { status?: number; body: unknown }[]) {
  const sent: Sent[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);

    sent.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      body: JSON.parse(await request.text()),
    });

    const answer = answers.shift() ?? { body: {} };

    return Response.json(answer.body, { status: answer.status ?? 200 });
  };

  return { sent, tavily: createTavily({ apiKey: "test-key", fetch }) };
}

test("searches news from the day before without a country, snipping each page's own text", async () => {
  const { sent, tavily } = fakeTavily({
    body: {
      query: "台積電 2330",
      results: [
        {
          url: "https://www.ctee.com.tw/news/1",
          title: "台積電法說前外資唱大戲",
          content: "excerpts picked for the query",
          score: 0.9,
          published_date: "Fri, 02 Oct 2026 03:30:00 GMT",
          raw_content: "摩根大通看好\n\n台積電第三季營收",
        },
        {
          url: "https://www.ctee.com.tw/news/1",
          title: "台積電法說前外資唱大戲",
          published_date: "Fri, 02 Oct 2026 03:30:00 GMT",
        },
        // 2026-09-27 02:00 in Taipei.
        {
          url: "https://stock.ltn.com.tw/article/2",
          title: "千金股解密",
          published_date: "Sat, 26 Sep 2026 18:00:00 GMT",
          raw_content: null,
        },
        // 2026-09-26 23:00 in Taipei, the day before the first.
        {
          url: "https://stock.ltn.com.tw/article/0",
          title: "Too old",
          published_date: "Sat, 26 Sep 2026 15:00:00 GMT",
        },
        {
          url: "https://udn.com/news/3",
          title: "Undated",
          published_date: null,
          raw_content: "台".repeat(450),
        },
        { url: "not an address", title: "Dropped" },
      ],
      response_time: 1.2,
    },
  });

  const results = await tavily.search({
    text: "台積電 2330",
    kind: WebSearchKind.News,
    since: SINCE,
    sites: [],
    market: Market.TW,
    limit: 10,
  });

  expect(sent).toEqual([
    {
      url: "https://api.tavily.com/search",
      authorization: "Bearer test-key",
      body: {
        query: "台積電 2330",
        topic: "news",
        max_results: 10,
        start_date: "2026-09-26",
        include_published_date: true,
        include_raw_content: "text",
      },
    },
  ]);
  expect(results).toEqual([
    {
      url: "https://www.ctee.com.tw/news/1",
      title: "台積電法說前外資唱大戲",
      snippet: "摩根大通看好 台積電第三季營收",
      site: "ctee.com.tw",
      // The day it falls on in Taipei, from its start.
      published: {
        at: new Date("2026-10-01T16:00:00Z"),
        precision: TimePrecision.Day,
      },
    },
    {
      url: "https://stock.ltn.com.tw/article/2",
      title: "千金股解密",
      snippet: "",
      site: "stock.ltn.com.tw",
      published: {
        at: new Date("2026-09-26T16:00:00Z"),
        precision: TimePrecision.Day,
      },
    },
    {
      url: "https://udn.com/news/3",
      title: "Undated",
      snippet: "台".repeat(400),
      site: "udn.com",
      published: null,
    },
  ]);
});

test("searches the web within hosts, favoring the market's country", async () => {
  const { sent, tavily } = fakeTavily({
    body: {
      results: [
        // 2026-09-29 22:15 in New York.
        {
          url: "https://x.com/someone/status/1",
          title: "$NVDA breaking out",
          published_date: "Wed, 30 Sep 2026 02:15:00 GMT",
          raw_content: "Volume is up",
        },
      ],
    },
  });

  const results = await tavily.search({
    text: "$NVDA",
    kind: WebSearchKind.Web,
    since: SINCE,
    sites: ["x.com"],
    market: Market.US,
    limit: 5,
  });

  expect(sent[0].body).toEqual({
    query: "$NVDA",
    topic: "general",
    max_results: 5,
    start_date: "2026-09-25",
    include_published_date: true,
    include_domains: ["x.com"],
    country: "united states",
    include_raw_content: "text",
  });
  expect(results[0].published).toEqual({
    at: new Date("2026-09-29T04:00:00Z"),
    precision: TimePrecision.Day,
  });
});

test("names Tavily and its reason when a request fails", async () => {
  const { tavily } = fakeTavily({
    status: 401,
    body: { detail: { error: "Unauthorized: missing or invalid API key." } },
  });

  await expect(
    tavily.search({
      text: "AAPL",
      kind: WebSearchKind.News,
      since: SINCE,
      sites: [],
      market: Market.US,
      limit: 10,
    })
  ).rejects.toThrow(
    "Tavily answered 401: Unauthorized: missing or invalid API key."
  );
});

test("reads a page's markdown, and says why it could not", async () => {
  const { sent, tavily } = fakeTavily(
    {
      body: {
        results: [
          {
            url: "https://investor.test/q3",
            raw_content: "# Q3\n\nRevenue rose.",
          },
        ],
        failed_results: [],
        response_time: 0.4,
      },
    },
    {
      body: {
        results: [],
        failed_results: [
          { url: "https://blocked.test/", error: "Failed to fetch url" },
        ],
      },
    }
  );

  await expect(tavily.read("https://investor.test/q3")).resolves.toEqual({
    url: "https://investor.test/q3",
    title: null,
    text: "# Q3\n\nRevenue rose.",
  });
  expect(sent[0]).toEqual({
    url: "https://api.tavily.com/extract",
    authorization: "Bearer test-key",
    body: { urls: ["https://investor.test/q3"], format: "markdown" },
  });

  await expect(tavily.read("https://blocked.test/")).rejects.toThrow(
    "Tavily could not read https://blocked.test/: Failed to fetch url"
  );
});
