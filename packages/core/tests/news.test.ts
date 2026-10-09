import { expect, test } from "vite-plus/test";

import { Market } from "../src/market.ts";
import type { SymbolRef } from "../src/market.ts";
import {
  NewsChannel,
  NewsVoice,
  TimePrecision,
  isAboutListing,
  rankHeadlines,
  readNews,
  storyText,
} from "../src/news.ts";
import type {
  ListingNews,
  NewsItem,
  NewsRecord,
  NewsSubject,
} from "../src/news.ts";
import { Stance, TextKind, TextSpeaker, TextTopic } from "../src/sentiment.ts";
import type { SentimentScore } from "../src/sentiment.ts";

const NOW = new Date("2026-10-03T05:00:00Z");

// Stories by identical titles only, as before the exchange's names are known.
const UNNAMED: NewsSubject = {
  symbol: { market: Market.TW, symbol: "2330" },
  listing: null,
};

function item(id: string, day: number): NewsItem {
  return {
    id,
    url: `https://news.test/${id}`,
    title: id,
    snippet: "",
    site: "news.test",
    published: {
      at: new Date(Date.UTC(2026, 8, day)),
      precision: TimePrecision.Minute,
    },
    votes: null,
  };
}

const SCORE: SentimentScore = {
  model: "jev-1.13.0",
  relevance: 0.9,
  stance: {
    [Stance.Negative]: 0,
    [Stance.LeanNegative]: 0,
    [Stance.Neutral]: 1,
    [Stance.LeanPositive]: 0,
    [Stance.Positive]: 0,
  },
  kind: {
    [TextKind.Report]: 1,
    [TextKind.Opinion]: 0,
    [TextKind.Promotion]: 0,
  },
  topic: {
    [TextTopic.Earnings]: 0,
    [TextTopic.Guidance]: 0,
    [TextTopic.Business]: 1,
    [TextTopic.Capital]: 0,
    [TextTopic.Analyst]: 0,
    [TextTopic.Legal]: 0,
    [TextTopic.Market]: 0,
    [TextTopic.Other]: 0,
  },
  // Spread evenly, so the model is unsure who speaks and the channel says.
  speaker: {
    [TextSpeaker.Company]: 0.2,
    [TextSpeaker.Outlet]: 0.2,
    [TextSpeaker.Investor]: 0.2,
    [TextSpeaker.Reference]: 0.2,
    [TextSpeaker.Other]: 0.2,
  },
};

/** `score` as the model reads it when all but sure that `speaker` wrote the text. */
function spokenBy(
  speaker: TextSpeaker,
  score: SentimentScore = SCORE
): SentimentScore {
  return {
    ...score,
    speaker: {
      [TextSpeaker.Company]: 0.01,
      [TextSpeaker.Outlet]: 0.01,
      [TextSpeaker.Investor]: 0.01,
      [TextSpeaker.Reference]: 0.01,
      [TextSpeaker.Other]: 0.01,
      [speaker]: 0.96,
    },
  };
}

function record(
  hour: string,
  score: SentimentScore | null,
  publishedAt: string | null = hour
): NewsRecord {
  return {
    source: "news",
    channel: NewsChannel.Article,
    item: {
      ...item(hour, 1),
      published:
        publishedAt === null
          ? null
          : { at: new Date(publishedAt), precision: TimePrecision.Minute },
    },
    foundAt: new Date("2026-10-03T01:00:00Z"),
    score,
  };
}

function scored(relevance: number, positive: number, promotion = 0) {
  return {
    ...SCORE,
    relevance,
    stance: {
      ...SCORE.stance,
      [Stance.Neutral]: 1 - positive,
      [Stance.Positive]: positive,
    },
    kind: {
      [TextKind.Report]: 1 - promotion,
      [TextKind.Opinion]: 0,
      [TextKind.Promotion]: promotion,
    },
  };
}

test("each day's stance weighs items by relevance and leaves promotions out", () => {
  const { daily: days } = readNews(
    [
      // 2026-10-02 in Taipei
      record("2026-10-02T02:00:00Z", scored(1, 1)),
      record("2026-10-02T03:00:00Z", scored(0.5, 0)),
      record("2026-10-02T04:00:00Z", scored(1, 1, 1)),
      // Only names the listing in passing, so it neither counts nor weighs.
      record("2026-10-02T05:00:00Z", scored(0.2, 1)),
      record("2026-10-02T06:00:00Z", null),
      // 2026-10-01 in Taipei, 23:30 the day before in UTC
      record("2026-09-30T16:30:00Z", null),
      // Undated, so it counts on the day it was found: 2026-10-03 in Taipei.
      record("undated", null, null),
    ],
    UNNAMED
  );

  expect(days).toEqual([
    { date: "2026-10-01", stance: null, weight: 0, stories: 1 },
    { date: "2026-10-02", stance: 2 / 3, weight: 1.5, stories: 4 },
    { date: "2026-10-03", stance: null, weight: 0, stories: 1 },
  ]);
});

test("the gauge reads 0 to 100 overall and for the press and the crowd apart", () => {
  const forum = (hour: string, score: SentimentScore | null): NewsRecord => ({
    ...record(hour, score),
    source: "ptt",
    channel: NewsChannel.Forum,
  });

  expect(
    readNews(
      [
        record("2026-10-02T02:00:00Z", scored(1, 1)),
        record("2026-10-02T03:00:00Z", scored(0.2, 0)),
        forum("2026-10-02T04:00:00Z", scored(1, 0)),
        forum("2026-10-02T05:00:00Z", null),
      ],
      UNNAMED
    ).gauge
  ).toEqual({
    overall: { score: 75, stories: 3 },
    voices: {
      [NewsVoice.Press]: { score: 100, stories: 1 },
      [NewsVoice.Crowd]: { score: 50, stories: 2 },
    },
  });

  expect(readNews([], UNNAMED).gauge).toEqual({
    overall: { score: null, stories: 0 },
    voices: {
      [NewsVoice.Press]: { score: null, stories: 0 },
      [NewsVoice.Crowd]: { score: null, stories: 0 },
    },
  });
});

function told(
  title: string,
  publishedAt: string,
  {
    channel = NewsChannel.Article,
    site = "news.test",
    score = null,
    precision = TimePrecision.Minute,
  }: {
    channel?: NewsChannel;
    site?: string;
    score?: SentimentScore | null;
    precision?: TimePrecision;
  } = {}
): NewsRecord {
  return {
    source: channel,
    channel,
    item: {
      id: `${site}/${title}/${publishedAt}`,
      url: null,
      title,
      snippet: "",
      site,
      published: { at: new Date(publishedAt), precision },
      votes: null,
    },
    foundAt: NOW,
    score,
  };
}

const storyTitles = (records: NewsRecord[]) =>
  readNews(records, UNNAMED).stories.map((story) =>
    story.records.map(({ item }) => `${item.site} ${item.title}`)
  );

test("reprints and replies are one story, newest story first", () => {
  expect(
    storyTitles([
      told("台積電法說會：上修全年營收展望", "2026-10-02T02:00:00Z", {
        site: "money.udn.com",
      }),
      told("台積電法說會 上修全年營收展望", "2026-10-02T03:00:00Z", {
        site: "tw.stock.yahoo.com",
      }),
      told("[新聞] 台積電擬赴美設第二園區", "2026-10-01T02:00:00Z", {
        channel: NewsChannel.Forum,
        site: "ptt.cc",
      }),
      told("Re: [新聞] 台積電擬赴美設第二園區", "2026-10-01T05:00:00Z", {
        channel: NewsChannel.Forum,
        site: "ptt.cc",
      }),
    ])
  ).toEqual([
    [
      "money.udn.com 台積電法說會：上修全年營收展望",
      "tw.stock.yahoo.com 台積電法說會 上修全年營收展望",
    ],
    [
      "ptt.cc [新聞] 台積電擬赴美設第二園區",
      "ptt.cc Re: [新聞] 台積電擬赴美設第二園區",
    ],
  ]);
});

test("titles that differ, are short, lie days apart or sit in other channels stay apart", () => {
  expect(
    readNews(
      [
        // One word apart, and saying the opposite.
        told("外資調升台積電目標價至1500元", "2026-10-02T02:00:00Z"),
        told("外資調降台積電目標價至1500元", "2026-10-02T03:00:00Z"),
        // Too short to tell two posts apart.
        told("台積電", "2026-10-02T02:00:00Z", { channel: NewsChannel.Social }),
        told("台積電", "2026-10-02T03:00:00Z", { channel: NewsChannel.Social }),
        // A column that runs under one title every week.
        told("本週法人買賣超排行", "2026-09-22T02:00:00Z"),
        told("本週法人買賣超排行", "2026-09-29T02:00:00Z"),
        // The same words in two voices are told apart.
        told("台積電擬赴美設第二園區", "2026-10-01T02:00:00Z"),
        told("台積電擬赴美設第二園區", "2026-10-01T03:00:00Z", {
          channel: NewsChannel.Forum,
        }),
      ],
      UNNAMED
    ).stories
  ).toHaveLength(8);
});

test("a story is led by its earliest scored record and weighed once", () => {
  const stories = readNews(
    [
      told("台積電法說會上修全年營收展望", "2026-10-02T02:00:00Z"),
      told("台積電法說會上修全年營收展望", "2026-10-02T03:00:00Z", {
        score: scored(1, 1),
      }),
      told("台積電法說會上修全年營收展望", "2026-10-02T04:00:00Z", {
        score: scored(1, 0),
      }),
    ],
    UNNAMED
  ).stories;

  expect(stories).toHaveLength(1);
  expect(stories[0].lead.item.published?.at).toEqual(
    new Date("2026-10-02T03:00:00Z")
  );

  expect(
    readNews(
      [
        ...stories[0].records,
        told("台積電擴大資本支出", "2026-10-02T05:00:00Z", {
          score: scored(1, 0),
        }),
      ],
      UNNAMED
    ).gauge.overall
  ).toEqual({ score: 75, stories: 2 });
});

const NAMED: NewsSubject = {
  symbol: { market: Market.TW, symbol: "2330" },
  listing: { name: "台積電", englishName: "TSMC" },
};

const storyTitlesOf = (records: NewsRecord[], subject: NewsSubject) =>
  readNews(records, subject).stories.map((story) =>
    story.records.map(({ item }) => item.title)
  );

test("outlets rewording one event within a day are one story once the listing's names are known", () => {
  const records = [
    told("台積電十月營收創新高 年增四成", "2026-10-02T02:00:00Z", {
      site: "a.test",
    }),
    told("快訊／台積電10月營收再創新高，年增逾四成", "2026-10-02T05:00:00Z", {
      site: "b.test",
    }),
    told("台積電將於下週舉行法說會", "2026-10-02T06:00:00Z", {
      site: "c.test",
    }),
  ];

  expect(storyTitlesOf(records, NAMED)).toEqual([
    ["台積電將於下週舉行法說會"],
    [
      "台積電十月營收創新高 年增四成",
      "快訊／台積電10月營收再創新高，年增逾四成",
    ],
  ]);

  // Every title names the listing, so without its names only identical titles are one story.
  expect(storyTitlesOf(records, UNNAMED)).toHaveLength(3);
});

test("a filing and an article retelling it the same day are one story, led by the filing", () => {
  const [story, ...others] = readNews(
    [
      told("本公司董事會決議發放現金股利", "2026-10-02T08:00:00Z", {
        channel: NewsChannel.Announcement,
        site: "mops.twse.com.tw",
      }),
      told("台積電董事會決議發放現金股利 每股5元", "2026-10-02T09:30:00Z"),
    ],
    NAMED
  ).stories;

  expect(others).toEqual([]);
  expect(story.channel).toBe(NewsChannel.Announcement);
  expect(story.records).toHaveLength(2);
});

test("the listing's names and the labels a site sets around its headlines do not make titles alike", () => {
  expect(
    storyTitlesOf(
      [
        told("台積電 外資連三賣", "2026-10-02T02:00:00Z", { site: "a.test" }),
        told("台積電 法說前夕股價創高", "2026-10-02T03:00:00Z", {
          site: "b.test",
        }),
        told("2330 台積電 - 繼續抱著 - 股市論壇", "2026-10-02T04:00:00Z", {
          site: "forum.test",
        }),
        told(
          "2330 台積電 - 全球配置的想法 - 股市論壇",
          "2026-10-02T05:00:00Z",
          {
            site: "forum.test",
          }
        ),
      ],
      NAMED
    )
  ).toHaveLength(4);

  // Another site's label around the same headline still reads as one story.
  expect(
    storyTitlesOf(
      [
        told("外資上修全年目標價至兩千元", "2026-10-02T02:00:00Z", {
          site: "a.test",
        }),
        told("討論牆 | 外資上修全年目標價至兩千元", "2026-10-02T02:30:00Z", {
          site: "b.test",
        }),
      ],
      NAMED
    )
  ).toHaveLength(1);
});

test("reworded titles stay apart a day apart, on two exchange days when one is dated by day, or in the other voice", () => {
  const reworded = "台積電10月營收再創新高，年增逾四成";

  expect(
    storyTitlesOf(
      [
        told("台積電十月營收創新高 年增四成", "2026-10-02T02:00:00Z"),
        told(reworded, "2026-10-03T03:00:00Z", { site: "b.test" }),
      ],
      NAMED
    )
  ).toHaveLength(2);

  expect(
    storyTitlesOf(
      [
        // 2026-10-02 in Taipei, known only by its day.
        told("台積電十月營收創新高 年增四成", "2026-10-01T16:00:00Z", {
          precision: TimePrecision.Day,
        }),
        // 23:00 on 2026-10-01 in Taipei: an hour earlier, but the day before.
        told(reworded, "2026-10-01T15:00:00Z", { site: "b.test" }),
      ],
      NAMED
    )
  ).toHaveLength(2);

  expect(
    storyTitlesOf(
      [
        told("台積電十月營收創新高 年增四成", "2026-10-02T02:00:00Z"),
        told(`[新聞] ${reworded}`, "2026-10-02T03:00:00Z", {
          channel: NewsChannel.Forum,
          site: "ptt.cc",
        }),
      ],
      NAMED
    )
  ).toHaveLength(2);
});

test("who speaks decides a story's voice where the model is sure, and its channel otherwise", () => {
  const { gauge } = readNews(
    [
      // A forum post a news search found: an article by its channel, an investor's by its words.
      told("外資連三賣 散戶還該抱著嗎", "2026-10-02T02:00:00Z", {
        site: "forum.test",
        score: spokenBy(TextSpeaker.Investor, scored(1, 0)),
      }),
      told("台積電法說會上修全年營收展望", "2026-10-02T03:00:00Z", {
        score: scored(1, 1),
      }),
    ],
    UNNAMED
  );

  expect(gauge.voices).toEqual({
    [NewsVoice.Press]: { score: 100, stories: 1 },
    [NewsVoice.Crowd]: { score: 50, stories: 1 },
  });
});

test("a page of data is no news about the listing", () => {
  const records = [
    told("毛利率查詢｜歷年毛利率與營益率分析", "2026-10-02T02:00:00Z", {
      site: "data.test",
      score: spokenBy(TextSpeaker.Reference, scored(1, 1)),
    }),
    told("台積電法說會上修全年營收展望", "2026-10-02T03:00:00Z", {
      score: scored(1, 1),
    }),
  ];

  const { stories, gauge } = readNews(records, UNNAMED);

  expect(stories.filter(isAboutListing)).toHaveLength(1);
  expect(gauge.overall.stories).toBe(1);
});

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const foundFor = (
  symbol: SymbolRef,
  ...records: NewsRecord[]
): ListingNews => ({ subject: { symbol, listing: null }, records });

const headlineTitles = (...listings: ListingNews[]) =>
  rankHeadlines(listings, NOW).map(({ story }) => story.lead.item.title);

function about(topic: TextTopic, score: SentimentScore): SentimentScore {
  return {
    ...score,
    topic: { ...SCORE.topic, [TextTopic.Business]: 0, [topic]: 1 },
  };
}

test("filings outrank the press and the press the crowd, all else alike", () => {
  expect(
    headlineTitles(
      foundFor(
        TSMC,
        told("PTT 熱議台積電法說會內容", "2026-10-02T02:00:00Z", {
          channel: NewsChannel.Forum,
        }),
        told("台積電董事會決議配發現金股利", "2026-10-02T02:00:00Z", {
          channel: NewsChannel.Announcement,
        }),
        told("台積電法說會上修全年營收展望", "2026-10-02T02:00:00Z")
      )
    )
  ).toEqual([
    "台積電董事會決議配發現金股利",
    "台積電法說會上修全年營收展望",
    "PTT 熱議台積電法說會內容",
  ]);
});

test("who speaks weighs a headline: an investor's post an outlet's site carries ranks below its articles", () => {
  const at = "2026-10-02T02:00:00Z";

  expect(
    headlineTitles(
      foundFor(
        TSMC,
        told("外資連三賣 散戶還該抱著嗎", at, {
          site: "forum.test",
          score: spokenBy(TextSpeaker.Investor),
        }),
        told("台積電擴大先進封裝產能", at, { score: SCORE }),
        told("毛利率查詢｜歷年毛利率與營益率分析", at, {
          site: "data.test",
          score: spokenBy(TextSpeaker.Reference),
        })
      )
    )
  ).toEqual(["台積電擴大先進封裝產能", "外資連三賣 散戶還該抱著嗎"]);
});

test("a story told more often or more lately weighs more", () => {
  expect(
    headlineTitles(
      foundFor(
        TSMC,
        told("台積電擬赴美設第二園區", "2026-09-27T02:00:00Z"),
        told("台積電法說會上修全年營收展望", "2026-10-02T02:00:00Z"),
        ...["money.udn.com", "cnyes.com", "ctee.com.tw"].map((site) =>
          told("台積電十月營收創新高", "2026-10-01T02:00:00Z", { site })
        )
      )
    )
  ).toEqual([
    "台積電十月營收創新高",
    "台積電法說會上修全年營收展望",
    "台積電擬赴美設第二園區",
  ]);
});

test("a scored story weighs by how material, relevant and clear its reading is", () => {
  const at = "2026-10-02T02:00:00Z";

  expect(
    headlineTitles(
      foundFor(
        TSMC,
        told("台積電第三季獲利優於預期", at, {
          score: about(TextTopic.Earnings, scored(1, 1)),
        }),
        told("台股今日成交量放大", at, {
          score: about(TextTopic.Market, scored(1, 1)),
        }),
        told("台積電將於下週公布財報", at, {
          score: about(TextTopic.Earnings, scored(1, 0)),
        }),
        told("加入群組領台積電飆股明牌", at, {
          score: about(TextTopic.Earnings, scored(1, 1, 1)),
        }),
        // Only names the listing in passing.
        told("半導體類股今日普遍上漲", at, {
          score: about(TextTopic.Earnings, scored(0.2, 1)),
        })
      )
    )
  ).toEqual([
    "台積電第三季獲利優於預期",
    "台積電將於下週公布財報",
    "台股今日成交量放大",
    "加入群組領台積電飆股明牌",
  ]);
});

test("a story found for several listings is one headline, led by the listing it weighs most for", () => {
  const at = "2026-10-02T02:00:00Z";
  const title = "鴻海與台積電合作 AI 伺服器";

  const headlines = rankHeadlines(
    [
      foundFor(
        TSMC,
        told(title, at, { score: scored(0.6, 1) }),
        told("台積電法說會上修全年營收展望", at, {
          score: about(TextTopic.Guidance, scored(1, 1)),
        })
      ),
      foundFor(FOXCONN, told(title, at, { score: scored(1, 1) })),
    ],
    NOW
  );

  expect(
    headlines.map(({ story, symbols }) => [
      story.lead.item.title,
      story.lead.score?.relevance,
      symbols.map(({ symbol }) => symbol),
    ])
  ).toEqual([
    ["台積電法說會上修全年營收展望", 1, ["2330"]],
    [title, 1, ["2317", "2330"]],
  ]);
});

test("a story's vector reads the title and the start of the snippet, its spaces folded", () => {
  expect(storyText({ title: " 台積電法說會 ", snippet: "" })).toBe(
    "台積電法說會"
  );
  expect(
    storyText({
      title: "台積電法說會",
      snippet: `上修\n\n展望${"。".repeat(600)}`,
    })
  ).toBe(`台積電法說會\n上修 展望${"。".repeat(495)}`);
});
