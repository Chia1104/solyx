import type { FirecrawlClientOptions } from "firecrawl";
import { beforeEach, expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";

import {
  createFirecrawlNews,
  createFirecrawlSocial,
} from "../src/firecrawl.ts";

const firecrawl = vi.hoisted(() => {
  const options: FirecrawlClientOptions[] = [];

  return { options, search: vi.fn() };
});

vi.mock("firecrawl", () => ({
  Firecrawl: class {
    constructor(options: FirecrawlClientOptions) {
      firecrawl.options.push(options);
    }

    search = firecrawl.search;
  },
}));

// 2026-10-03 13:30 in Taipei.
const NOW = new Date("2026-10-03T05:30:00Z");

const TSMC = { market: Market.TW, symbol: "2330" };

beforeEach(() => {
  firecrawl.options.length = 0;
  firecrawl.search.mockReset();
});

test("searches Taiwan news for the listing's name within the dates", async () => {
  firecrawl.search.mockResolvedValue({ news: [] });

  const source = createFirecrawlNews({ apiKey: "test-key", now: () => NOW });

  await source.search({
    symbol: TSMC,
    listing: { name: "台積電", englishName: "TSMC" },
    // 2026-09-27 01:00 in Taipei, still the 26th in UTC.
    since: new Date("2026-09-26T17:00:00Z"),
    limit: 10,
  });

  expect(firecrawl.options).toEqual([
    { apiKey: "test-key", apiUrl: "https://api.firecrawl.dev" },
  ]);
  expect(firecrawl.search).toHaveBeenCalledWith("台積電 2330", {
    sources: ["news"],
    limit: 10,
    location: "Taiwan",
    tbs: "cdr:1,cd_min:9/27/2026,cd_max:10/3/2026",
    highlights: false,
  });
});

test("dates results by their age and drops malformed or repeated ones", async () => {
  firecrawl.search.mockResolvedValue({
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
        date: "Sep 29, 2026",
      },
      { title: "No address", snippet: "dropped" },
      {
        title: "Undated",
        url: "https://udn.com/news/3",
        snippet: "kept",
        date: "yesterday-ish",
      },
    ],
  });

  const source = createFirecrawlNews({ apiKey: "test-key", now: () => NOW });

  const items = await source.search({
    symbol: TSMC,
    listing: null,
    since: new Date("2026-09-26T17:00:00Z"),
    limit: 10,
  });

  expect(firecrawl.search.mock.calls[0][0]).toBe("2330");
  expect(items).toEqual([
    {
      url: "https://www.ctee.com.tw/news/1",
      title: "台積電法說前外資唱大戲",
      snippet: "摩根大通看好台積電第三季營收",
      site: "ctee.com.tw",
      publishedAt: new Date("2026-10-02T23:30:00Z"),
      votes: null,
    },
    {
      url: "https://stock.ltn.com.tw/article/2",
      title: "千金股解密",
      snippet: "",
      site: "stock.ltn.com.tw",
      publishedAt: new Date(Date.parse("Sep 29, 2026")),
      votes: null,
    },
    {
      url: "https://udn.com/news/3",
      title: "Undated",
      snippet: "kept",
      site: "udn.com",
      publishedAt: null,
      votes: null,
    },
  ]);
});

test("samples Threads posts in Taiwan, dated by the start of their description", async () => {
  firecrawl.search.mockResolvedValue({
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
  });

  const source = createFirecrawlSocial({ apiKey: "test-key", now: () => NOW });

  const items = await source.search({
    symbol: TSMC,
    listing: { name: "台積電", englishName: "TSMC" },
    since: new Date("2026-09-26T17:00:00Z"),
    limit: 10,
  });

  expect(firecrawl.search).toHaveBeenCalledWith("台積電 site:threads.com", {
    sources: ["web"],
    limit: 10,
    location: "Taiwan",
    tbs: "cdr:1,cd_min:9/27/2026,cd_max:10/3/2026",
    highlights: false,
  });
  expect(items).toEqual([
    {
      url: "https://www.threads.com/@someone/post/Dd-Bd",
      title: "台積電第二個美國基地，可能要來了？",
      snippet: "台積電擬規劃啟動美國第二園區建廠作業",
      site: "threads.com",
      publishedAt: new Date("2026-10-02T07:30:00Z"),
      votes: null,
    },
    {
      url: "https://www.threads.com/@other/post/Dd-Cc",
      title: "台積電 · 盤整",
      snippet: "沒有日期 · 但有分隔符號",
      site: "threads.com",
      publishedAt: null,
      votes: null,
    },
  ]);
});

test("samples X posts by cashtag in the US", async () => {
  firecrawl.search.mockResolvedValue({ web: [] });

  const source = createFirecrawlSocial({ apiKey: "test-key", now: () => NOW });

  await source.search({
    symbol: { market: Market.US, symbol: "NVDA" },
    listing: null,
    since: new Date("2026-09-26T17:00:00Z"),
    limit: 10,
  });

  expect(firecrawl.search).toHaveBeenCalledWith(
    "$NVDA site:x.com",
    expect.objectContaining({ location: "United States" })
  );
});
