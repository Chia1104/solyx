import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import { WebSearchKind } from "@solyx/core/web-search";

import { createExa } from "../src/exa.ts";

// 2026-09-27 01:00 in Taipei, still the 26th in UTC.
const SINCE = new Date("2026-09-26T17:00:00Z");

interface Sent {
  url: string;
  key: string | null;
  body: unknown;
}

/** Answers each request with the next body, as JSON with the status given beside it. */
function fakeExa(...answers: { status?: number; body: unknown }[]) {
  const sent: Sent[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);

    sent.push({
      url: request.url,
      key: request.headers.get("x-api-key"),
      body: JSON.parse(await request.text()),
    });

    const answer = answers.shift() ?? { body: {} };

    return Response.json(answer.body, { status: answer.status ?? 200 });
  };

  return { sent, exa: createExa({ apiKey: "test-key", fetch }) };
}

test("searches news in the market's country from the day before, keeping the first day on", async () => {
  const { sent, exa } = fakeExa({
    body: {
      requestId: "r1",
      results: [
        {
          id: "1",
          url: "https://www.ctee.com.tw/news/1",
          title: "台積電法說前外資唱大戲",
          publishedDate: "2026-10-02T00:00:00.000Z",
          text: "摩根大通看好\n台積電第三季營收",
        },
        {
          id: "2",
          url: "https://www.ctee.com.tw/news/1",
          title: "台積電法說前外資唱大戲",
          publishedDate: "2026-10-02T00:00:00.000Z",
        },
        // 2026-09-27 02:00 in Taipei.
        {
          id: "3",
          url: "https://stock.ltn.com.tw/article/2",
          title: "千金股解密",
          publishedDate: "2026-09-26T18:00:00.000Z",
          text: "",
        },
        // The day before the first, which Exa returns since the range starts a day early.
        {
          id: "4",
          url: "https://stock.ltn.com.tw/article/0",
          title: "Too old",
          publishedDate: "2026-09-26T00:00:00.000Z",
        },
        { id: "5", url: "https://udn.com/news/3", title: "Undated" },
        { id: "6", url: "not an address", title: "Dropped" },
      ],
    },
  });

  const results = await exa.search({
    text: "台積電 2330",
    kind: WebSearchKind.News,
    since: SINCE,
    sites: [],
    market: Market.TW,
    limit: 10,
  });

  expect(sent).toEqual([
    {
      url: "https://api.exa.ai/search",
      key: "test-key",
      body: {
        query: "台積電 2330",
        type: "auto",
        numResults: 10,
        category: "news",
        startPublishedDate: "2026-09-26T00:00:00.000Z",
        userLocation: "TW",
        contents: { text: { maxCharacters: 400 } },
      },
    },
  ]);
  expect(results).toEqual([
    {
      url: "https://www.ctee.com.tw/news/1",
      title: "台積電法說前外資唱大戲",
      snippet: "摩根大通看好 台積電第三季營收",
      site: "ctee.com.tw",
      // The day Exa names, starting in Taipei.
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
      snippet: "",
      site: "udn.com",
      published: null,
    },
  ]);
});

test("searches the web within hosts, without a market reading days on UTC's calendar", async () => {
  const { sent, exa } = fakeExa({
    body: {
      results: [
        {
          url: "https://x.com/someone/status/1",
          title: "$NVDA breaking out",
          publishedDate: "2026-09-30T21:15:00.000Z",
          text: "Volume is up",
        },
      ],
    },
  });

  const results = await exa.search({
    text: "$NVDA",
    kind: WebSearchKind.Web,
    since: SINCE,
    sites: ["x.com"],
    market: null,
    limit: 5,
  });

  expect(sent[0].body).toEqual({
    query: "$NVDA",
    type: "auto",
    numResults: 5,
    includeDomains: ["x.com"],
    startPublishedDate: "2026-09-25T00:00:00.000Z",
    contents: { text: { maxCharacters: 400 } },
  });
  expect(results[0].published).toEqual({
    at: new Date("2026-09-30T00:00:00Z"),
    precision: TimePrecision.Day,
  });
});

test("names Exa and its reason when a request fails", async () => {
  const { exa } = fakeExa({
    status: 401,
    body: { requestId: "r2", error: "Invalid API key" },
  });

  await expect(
    exa.search({
      text: "AAPL",
      kind: WebSearchKind.News,
      since: SINCE,
      sites: [],
      market: Market.US,
      limit: 10,
    })
  ).rejects.toThrow("Exa answered 401: Invalid API key");
});

test("reads a page's text, and says why it could not", async () => {
  const { sent, exa } = fakeExa(
    {
      body: {
        results: [
          {
            url: "https://investor.test/q3",
            title: "Q3 results",
            text: "Revenue rose.",
          },
        ],
        statuses: [{ id: "https://investor.test/q3", status: "success" }],
      },
    },
    {
      body: {
        results: [],
        statuses: [
          {
            id: "https://blocked.test/",
            status: "error",
            error: { tag: "CRAWL_NOT_FOUND", httpStatusCode: 404 },
          },
        ],
      },
    }
  );

  await expect(exa.read("https://investor.test/q3")).resolves.toEqual({
    url: "https://investor.test/q3",
    title: "Q3 results",
    text: "Revenue rose.",
  });
  expect(sent[0]).toEqual({
    url: "https://api.exa.ai/contents",
    key: "test-key",
    body: { urls: ["https://investor.test/q3"], text: true },
  });

  await expect(exa.read("https://blocked.test/")).rejects.toThrow(
    "Exa could not read https://blocked.test/: CRAWL_NOT_FOUND"
  );
});
