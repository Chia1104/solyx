import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import { createLongbridgeApi } from "@solyx/market-data/longbridge-api";

import {
  createLongbridgeNews,
  createLongbridgeTopics,
} from "../src/longbridge-content.ts";

const APPLE = { symbol: { market: Market.US, symbol: "AAPL" }, listing: null };

const seconds = (at: string) => String(Date.parse(at) / 1000);

/** A story or post as Longbridge lists it. */
const entry = (
  id: string,
  title: string,
  at: string,
  { description = "", likes = 0 } = {}
) => ({
  id,
  title,
  description,
  url: `https://longbridge.com/news/${id}`,
  published_at: seconds(at),
  comments_count: 0,
  likes_count: likes,
  shares_count: 0,
});

function fakeLongbridge(items: object[]) {
  const asked: Request[] = [];

  const api = createLongbridgeApi({
    accessToken: async () => "hk_access",
    fetch: async (input, init) => {
      asked.push(new Request(input, init));

      return Response.json({ code: 0, message: "success", data: { items } });
    },
  });

  return { asked, api };
}

test("a US listing's news comes newest first from Longbridge's feed, in its own words", async () => {
  const { api, asked } = fakeLongbridge([
    entry("1", "蘋果發佈會的全部新聞", "2026-10-28T15:00:00Z", {
      description: "蘋果 &amp; 合作夥伴推出新品",
    }),
    entry("2", "觸屏 MacBook 實時博客", "2026-10-28T16:00:00Z"),
    // Before the day asked from.
    entry("3", "舊聞", "2026-09-01T00:00:00Z"),
  ]);

  const news = createLongbridgeNews({ api });

  expect(news.channel).toBe(NewsChannel.Article);
  expect(news.markets).toEqual([Market.US]);

  const items = await news.search({
    ...APPLE,
    since: new Date("2026-10-01T00:00:00Z"),
    limit: 10,
  });

  expect(items).toEqual([
    expect.objectContaining({ title: "觸屏 MacBook 實時博客" }),
    {
      id: "https://longbridge.com/news/1",
      url: "https://longbridge.com/news/1",
      title: "蘋果發佈會的全部新聞",
      snippet: "蘋果 & 合作夥伴推出新品",
      site: "longbridge.com",
      published: {
        at: new Date("2026-10-28T15:00:00Z"),
        precision: TimePrecision.Minute,
      },
      votes: null,
    },
  ]);
  expect(new URL(asked[0].url).pathname).toBe("/v1/content/AAPL.US/news");
});

test("a story with no title takes the start of its summary, and one with neither is dropped", async () => {
  const summary = "蘋果今日公布".padEnd(100, "，市場關注");

  const { api } = fakeLongbridge([
    entry("1", "", "2026-10-28T15:00:00Z", { description: summary }),
    entry("2", "   ", "2026-10-28T14:00:00Z"),
  ]);

  const items = await createLongbridgeNews({ api }).search({
    ...APPLE,
    since: new Date(0),
    limit: 10,
  });

  expect(items.map(({ title }) => title)).toEqual([`${summary.slice(0, 80)}…`]);
});

test("Longbridge's community posts are a US listing's forum, its readers' likes as votes", async () => {
  const { api, asked } = fakeLongbridge([
    entry("9", "NVDA GTC in focus | Daily News Recap", "2026-10-27T12:00:00Z", {
      likes: 7,
    }),
  ]);

  const topics = createLongbridgeTopics({ api });

  expect(topics.channel).toBe(NewsChannel.Forum);

  const [post] = await topics.search({
    ...APPLE,
    since: new Date(0),
    limit: 10,
  });

  expect(post).toMatchObject({ votes: 7, site: "longbridge.com" });
  expect(new URL(asked[0].url).pathname).toBe("/v1/content/AAPL.US/topics");
});

test("a post's tags of listings and mentions read as the names they show", async () => {
  const { api } = fakeLongbridge([
    entry(
      "7",
      "[st]ST/US/TSLA#特斯拉.US[/st]你和蘋果已經完成護盤的任務了",
      "2026-10-28T11:20:00Z",
      { description: "本期做客的[at]@小R老板[/at] ，是長橋社區的股主" }
    ),
  ]);

  const [post] = await createLongbridgeTopics({ api }).search({
    ...APPLE,
    since: new Date(0),
    limit: 10,
  });

  expect(post).toMatchObject({
    title: "特斯拉.US你和蘋果已經完成護盤的任務了",
    snippet: "本期做客的@小R老板 ，是長橋社區的股主",
  });
});

test("an entry that does not read is dropped, but a feed none of whose entries read fails", async () => {
  const kept = fakeLongbridge([
    entry("1", "可讀", "2026-10-28T15:00:00Z"),
    { id: 2, title: null },
  ]);

  expect(
    await createLongbridgeNews({ api: kept.api }).search({
      ...APPLE,
      since: new Date(0),
      limit: 10,
    })
  ).toHaveLength(1);

  const garbled = fakeLongbridge([{ id: 2 }]);

  await expect(
    createLongbridgeNews({ api: garbled.api }).search({
      ...APPLE,
      since: new Date(0),
      limit: 10,
    })
  ).rejects.toThrow("none of the 1 rows of the news of AAPL read as expected");
});
