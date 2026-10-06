import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import { WebSearchKind } from "@solyx/core/web-search";
import type { WebResult } from "@solyx/core/web-search";

import { createWebNews, createWebSocial } from "../src/web.ts";

const SINCE = new Date("2026-09-26T17:00:00Z");

const RESULT: WebResult = {
  url: "https://www.ctee.com.tw/news/1",
  title: "台積電法說前外資唱大戲",
  snippet: "摩根大通看好台積電第三季營收",
  site: "ctee.com.tw",
  published: {
    at: new Date("2026-10-02T23:30:00Z"),
    precision: TimePrecision.Hour,
  },
};

const fakeWeb = (results: WebResult[] = []) => ({
  search: vi.fn(async () => results),
});

test("searches news for the listing's name and code in its market", async () => {
  const web = fakeWeb([RESULT]);
  const source = createWebNews(web);

  const items = await source.search({
    symbol: { market: Market.TW, symbol: "2330" },
    listing: { name: "台積電", englishName: "TSMC" },
    since: SINCE,
    limit: 10,
  });

  expect(source).toMatchObject({
    id: "web-article",
    channel: NewsChannel.Article,
  });
  expect(web.search).toHaveBeenCalledWith({
    text: "台積電 2330",
    kind: WebSearchKind.News,
    since: SINCE,
    sites: [],
    market: Market.TW,
    limit: 10,
  });
  expect(items).toEqual([
    {
      id: RESULT.url,
      url: RESULT.url,
      title: RESULT.title,
      snippet: RESULT.snippet,
      site: RESULT.site,
      published: RESULT.published,
      votes: null,
    },
  ]);
});

/** A result the vendor found at `url`, undated unless `published` says otherwise. */
const found = (url: string, published: WebResult["published"] = null) => ({
  url,
  title: "緯穎除權",
  snippet: "",
  site: new URL(url).hostname.replace(/^www\./, ""),
  published,
});

test("samples Threads posts by name in Taiwan, dated by their codes, leaving out other pages", async () => {
  const web = fakeWeb([
    // Made 2026-04-15 05:05 UTC, as its code says.
    found("https://www.threads.com/@someone/post/DXI9JdYE6rR/緯穎"),
    // Made 2025-06-10, before the first day.
    found("https://www.threads.com/@someone/post/DKtnrdRznzD"),
    // A code that reads in the future keeps the vendor's date.
    found("https://www.threads.com/@someone/post/zzzzzzzzzzzz", {
      at: new Date("2026-04-20T00:00:00Z"),
      precision: TimePrecision.Hour,
    }),
    found("https://www.threads.com/@asus"),
    found("https://www.instagram.com/p/DXI9JdYE6rR"),
  ]);

  const source = createWebSocial(web);

  const items = await source.search({
    symbol: { market: Market.TW, symbol: "6669" },
    listing: { name: "緯穎", englishName: "Wiwynn" },
    since: new Date("2026-04-01T00:00:00Z"),
    limit: 10,
  });

  expect(source).toMatchObject({
    id: "web-social",
    channel: NewsChannel.Social,
  });
  expect(web.search).toHaveBeenCalledWith(
    expect.objectContaining({
      text: "緯穎",
      kind: WebSearchKind.Web,
      sites: ["threads.com"],
      market: Market.TW,
    })
  );
  expect(items.map(({ url, published }) => ({ url, published }))).toEqual([
    {
      url: "https://www.threads.com/@someone/post/DXI9JdYE6rR/緯穎",
      published: {
        at: new Date("2026-04-15T05:05:00.553Z"),
        precision: TimePrecision.Minute,
      },
    },
    {
      url: "https://www.threads.com/@someone/post/zzzzzzzzzzzz",
      published: {
        at: new Date("2026-04-20T00:00:00Z"),
        precision: TimePrecision.Hour,
      },
    },
  ]);
});

test("samples X posts by cashtag in the US, dated by their ids", async () => {
  const web = fakeWeb([
    found("https://x.com/someone/status/2105289118970818617"),
    found("https://x.com/someone"),
  ]);

  const items = await createWebSocial(web).search({
    symbol: { market: Market.US, symbol: "NVDA" },
    listing: null,
    since: SINCE,
    limit: 10,
  });

  expect(web.search).toHaveBeenCalledWith(
    expect.objectContaining({ text: "$NVDA", sites: ["x.com"] })
  );
  expect(items.map(({ url, published }) => ({ url, published }))).toEqual([
    {
      url: "https://x.com/someone/status/2105289118970818617",
      published: {
        at: new Date("2026-09-30T13:30:15Z"),
        precision: TimePrecision.Minute,
      },
    },
  ]);
});
