import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import { WebSearchKind } from "@solyx/core/web-search";

import { createFirecrawl } from "../src/firecrawl.ts";

// 2026-10-03 13:30 in Taipei.
const NOW = new Date("2026-10-03T05:30:00Z");

// 2026-09-27 01:00 in Taipei, still the 26th in UTC.
const SINCE = new Date("2026-09-26T17:00:00Z");

interface Sent {
  url: string;
  authorization: string | null;
  body: unknown;
}

/** Answers each request with the next body, as JSON with the status given beside it. */
function fakeFirecrawl(...answers: { status?: number; body: unknown }[]) {
  const sent: Sent[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);

    sent.push({
      url: request.url,
      authorization: request.headers.get("Authorization"),
      body: JSON.parse(await request.text()),
    });

    const answer = answers.shift() ?? { body: {} };

    return Response.json(answer.body, { status: answer.status ?? 200 });
  };

  return {
    sent,
    firecrawl: createFirecrawl({ apiKey: "test-key", fetch, now: () => NOW }),
  };
}

test("searches news in the market's country and keeps results from the first day on", async () => {
  const { sent, firecrawl } = fakeFirecrawl({
    body: {
      success: true,
      data: {
        news: [
          {
            title: "台積電法說前外資唱大戲",
            url: "https://www.ctee.com.tw/news/1",
            snippet: "摩根大通看好台積電第三季營收",
            date: "6 hours ago",
          },
          {
            title: "台積電法說前外資唱大戲",
            url: "https://www.ctee.com.tw/news/1",
            date: "6 hours ago",
          },
          {
            title: "千金股解密",
            url: "https://stock.ltn.com.tw/article/2",
            date: "Sep 27, 2026",
          },
          // Firecrawl's news results ignore the date range.
          {
            title: "Too old",
            url: "https://stock.ltn.com.tw/article/0",
            date: "Sep 26, 2026",
          },
          { title: "No address", snippet: "dropped" },
          {
            title: "Undated",
            url: "https://udn.com/news/3",
            snippet: "kept",
            date: "yesterday-ish",
          },
        ],
      },
    },
  });

  const results = await firecrawl.search({
    text: "台積電 2330",
    kind: WebSearchKind.News,
    since: SINCE,
    sites: [],
    market: Market.TW,
    limit: 10,
  });

  expect(sent).toEqual([
    {
      url: "https://api.firecrawl.dev/v2/search",
      authorization: "Bearer test-key",
      body: {
        query: "台積電 2330",
        sources: ["news"],
        limit: 10,
        country: "TW",
        location: "Taiwan",
        highlights: false,
      },
    },
  ]);
  expect(results).toEqual([
    {
      url: "https://www.ctee.com.tw/news/1",
      title: "台積電法說前外資唱大戲",
      snippet: "摩根大通看好台積電第三季營收",
      site: "ctee.com.tw",
      published: {
        at: new Date("2026-10-02T23:30:00Z"),
        precision: TimePrecision.Hour,
      },
    },
    {
      url: "https://stock.ltn.com.tw/article/2",
      title: "千金股解密",
      snippet: "",
      site: "stock.ltn.com.tw",
      // The start of that day in Taipei, wherever this computer is.
      published: {
        at: new Date("2026-09-26T16:00:00Z"),
        precision: TimePrecision.Day,
      },
    },
    {
      url: "https://udn.com/news/3",
      title: "Undated",
      snippet: "kept",
      site: "udn.com",
      published: null,
    },
  ]);
});

test("ages are as exact as their unit, and dates name a day on the market's calendar", async () => {
  const { firecrawl } = fakeFirecrawl({
    body: {
      data: {
        news: [
          {
            title: "Minutes",
            url: "https://news.test/1",
            date: "5 minutes ago",
          },
          { title: "Days", url: "https://news.test/2", date: "2 days ago" },
          { title: "Date", url: "https://news.test/3", date: "Sep 29, 2026" },
        ],
      },
    },
  });

  const results = await firecrawl.search({
    text: "AAPL",
    kind: WebSearchKind.News,
    since: SINCE,
    sites: [],
    market: Market.US,
    limit: 10,
  });

  expect(results.map((result) => result.published)).toEqual([
    {
      at: new Date("2026-10-03T05:25:00Z"),
      precision: TimePrecision.Minute,
    },
    { at: new Date("2026-10-01T05:30:00Z"), precision: TimePrecision.Day },
    // Midnight in New York, on daylight time.
    { at: new Date("2026-09-29T04:00:00Z"), precision: TimePrecision.Day },
  ]);
});

test("searches the web within hosts and dates, dating results by the start of their description", async () => {
  const { sent, firecrawl } = fakeFirecrawl({
    body: {
      data: {
        web: [
          {
            url: "https://www.threads.com/@someone/post/Dd-Bd",
            title: "台積電第二個美國基地，可能要來了？",
            description: "22 hours ago · 台積電擬規劃啟動美國第二園區建廠作業",
          },
          {
            url: "https://www.threads.com/@other/post/Dd-Cc",
            title: "台積電 · 盤整",
            description: "沒有日期 · 但有分隔符號",
          },
        ],
      },
    },
  });

  const results = await firecrawl.search({
    text: "台積電",
    kind: WebSearchKind.Web,
    since: SINCE,
    sites: ["threads.com"],
    market: Market.TW,
    limit: 10,
  });

  expect(sent[0].body).toEqual({
    query: "台積電 site:threads.com",
    sources: ["web"],
    limit: 10,
    country: "TW",
    location: "Taiwan",
    tbs: "cdr:1,cd_min:9/27/2026,cd_max:10/3/2026",
    highlights: false,
  });
  expect(results).toEqual([
    {
      url: "https://www.threads.com/@someone/post/Dd-Bd",
      title: "台積電第二個美國基地，可能要來了？",
      snippet: "台積電擬規劃啟動美國第二園區建廠作業",
      site: "threads.com",
      published: {
        at: new Date("2026-10-02T07:30:00Z"),
        precision: TimePrecision.Hour,
      },
    },
    {
      url: "https://www.threads.com/@other/post/Dd-Cc",
      title: "台積電 · 盤整",
      snippet: "沒有日期 · 但有分隔符號",
      site: "threads.com",
      published: null,
    },
  ]);
});

test("without a market, searches every country and reads dates on UTC's calendar", async () => {
  const { sent, firecrawl } = fakeFirecrawl({
    body: {
      data: {
        web: [
          {
            url: "https://fed.test/minutes",
            title: "FOMC minutes",
            description: "Sep 30, 2026 · The Committee decided",
          },
        ],
      },
    },
  });

  const results = await firecrawl.search({
    text: "FOMC minutes",
    kind: WebSearchKind.Web,
    since: SINCE,
    sites: ["fed.test", "bls.test"],
    market: null,
    limit: 5,
  });

  expect(sent[0].body).toEqual({
    query: "FOMC minutes site:fed.test OR site:bls.test",
    sources: ["web"],
    limit: 5,
    tbs: "cdr:1,cd_min:9/26/2026,cd_max:10/3/2026",
    highlights: false,
  });
  expect(results[0].published).toEqual({
    at: new Date("2026-09-30T00:00:00Z"),
    precision: TimePrecision.Day,
  });
});

test("names Firecrawl and its reason when a request fails", async () => {
  const { firecrawl } = fakeFirecrawl({
    status: 402,
    body: { success: false, error: "Insufficient credits" },
  });

  await expect(
    firecrawl.search({
      text: "2330",
      kind: WebSearchKind.News,
      since: SINCE,
      sites: [],
      market: Market.TW,
      limit: 10,
    })
  ).rejects.toThrow("Firecrawl answered 402: Insufficient credits");
});

test("reads a page's main content as Markdown", async () => {
  const { sent, firecrawl } = fakeFirecrawl({
    body: {
      success: true,
      data: {
        markdown: "# Q3 results\n\nRevenue rose.",
        metadata: { title: "Q3 results", statusCode: 200 },
      },
    },
  });

  const page = await firecrawl.read("https://investor.test/q3");

  expect(sent[0]).toEqual({
    url: "https://api.firecrawl.dev/v2/scrape",
    authorization: "Bearer test-key",
    body: {
      url: "https://investor.test/q3",
      formats: ["markdown"],
      onlyMainContent: true,
    },
  });
  expect(page).toEqual({
    url: "https://investor.test/q3",
    title: "Q3 results",
    text: "# Q3 results\n\nRevenue rose.",
  });
});
