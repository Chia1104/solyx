import { Market } from "@solyx/core/market";
import type { Listing } from "@solyx/core/market-data";
import { NewsChannel } from "@solyx/core/news";
import { TextSpeaker } from "@solyx/core/sentiment";
import type { SentimentInput } from "@solyx/core/sentiment";

/** A synthetic item as a news source would hand it over, with who wrote it. */
export interface SpeakerSample {
  input: SentimentInput;
  /** The channel the source that found it files it under. */
  channel: NewsChannel;
  speaker: TextSpeaker;
  /** What makes the speaker clear, or hard to tell. */
  note: string;
}

const TSMC = {
  symbol: { market: Market.TW, symbol: "2330" },
  listing: { name: "台積電", englishName: "TSMC" } satisfies Listing,
};

const APPLE = {
  symbol: { market: Market.US, symbol: "AAPL" },
  listing: { name: "Apple", englishName: "Apple" } satisfies Listing,
};

function sample(
  speaker: TextSpeaker,
  channel: NewsChannel,
  note: string,
  input: Omit<SentimentInput, "symbol" | "listing">,
  listing: typeof TSMC | typeof APPLE = TSMC
): SpeakerSample {
  return { input: { ...listing, ...input }, channel, speaker, note };
}

export const SPEAKER_SAMPLES: SpeakerSample[] = [
  sample(TextSpeaker.Company, NewsChannel.Announcement, "a filing", {
    title: "本公司董事會決議配發每股現金股利5元",
    text: "1.董事會決議日期：115/11/12 2.股利所屬年(季)度：115年第3季 3.每股分派現金股利新台幣5元",
    site: "mops.twse.com.tw",
    url: null,
  }),
  sample(
    TextSpeaker.Company,
    NewsChannel.Article,
    "the company's press room, found by a news search",
    {
      title: "台積電公布第三季財務報告",
      text: "台積電今日公布第三季財務報告，合併營收較去年同期增加三成，毛利率五成九。",
      site: "pr.tsmc.com",
      url: "https://pr.tsmc.com/chinese/news/9001",
    }
  ),
  sample(
    TextSpeaker.Company,
    NewsChannel.Article,
    "a press release in English",
    {
      title: "Apple reports fourth quarter results",
      text: "Apple today announced financial results for its fiscal fourth quarter, posting revenue up 8 percent year over year.",
      site: "apple.com",
      url: "https://www.apple.com/newsroom/2026/10/apple-reports-fourth-quarter-results/",
    },
    APPLE
  ),
  sample(TextSpeaker.Outlet, NewsChannel.Article, "a news report", {
    title: "台積電法說會釋利多 第四季營收估季增一成",
    text: "台積電今日召開法說會，財務長表示第四季營收可望季增約一成，先進製程需求持續強勁。",
    site: "news.cnyes.com",
    url: "https://news.cnyes.com/news/id/9000001",
  }),
  sample(
    TextSpeaker.Outlet,
    NewsChannel.Article,
    "an outlet reports a broker's view",
    {
      title: "外資上修台積電目標價至2800元",
      text: "外資券商最新報告指出，台積電先進封裝產能吃緊，將目標價上調至2800元並維持買進評等。",
      site: "money.udn.com",
      url: "https://money.udn.com/money/story/5612/9000002",
    }
  ),
  sample(TextSpeaker.Outlet, NewsChannel.Article, "a broker's research note", {
    title: "台積電(2330) 個股研究報告：維持買進評等",
    text: "本報告預估台積電明年每股盈餘成長兩成，維持買進評等，目標價2700元。",
    site: "sinotrade.com.tw",
    url: "https://www.sinotrade.com.tw/richclub/stock/9000003",
  }),
  sample(TextSpeaker.Outlet, NewsChannel.Article, "an outlet's column", {
    title: "專欄：AI 伺服器需求還能撐多久",
    text: "本欄作者分析雲端業者資本支出，認為晶圓代工的高成長至少延續到明年下半年。",
    site: "ctee.com.tw",
    url: "https://www.ctee.com.tw/news/20261010700000-431401",
  }),
  sample(
    TextSpeaker.Outlet,
    NewsChannel.Article,
    "a wire story in English",
    {
      title: "Apple shares rise after iPhone demand beats forecasts",
      text: "Shares of Apple rose 3% on Friday after the company said demand for its new iPhone had exceeded expectations.",
      site: "reuters.com",
      url: "https://www.reuters.com/technology/apple-shares-rise-9000004/",
    },
    APPLE
  ),
  sample(TextSpeaker.Investor, NewsChannel.Forum, "a forum post's title", {
    title: "[標的] 2330 台積電 多",
    text: "",
    site: "ptt.cc",
    url: "https://www.ptt.cc/bbs/Stock/M.1760000000.A.ABC.html",
  }),
  sample(
    TextSpeaker.Investor,
    NewsChannel.Forum,
    "an investor reposts an article on a forum",
    {
      title: "[新聞] 台積電擬赴美設第二座先進封裝廠",
      text: "",
      site: "ptt.cc",
      url: "https://www.ptt.cc/bbs/Stock/M.1760000100.A.DEF.html",
    }
  ),
  sample(
    TextSpeaker.Investor,
    NewsChannel.Article,
    "a forum post a news search found on a news site",
    {
      title: "2330 台積電 - 繼續抱著，明年見 - 股市爆料同學會",
      text: "抱了三年了，不管外資怎麼賣我都不賣，等明年配息。",
      site: "cmoney.tw",
      url: "https://www.cmoney.tw/forum/article/900000005",
    }
  ),
  sample(
    TextSpeaker.Investor,
    NewsChannel.Article,
    "a question on a general forum",
    {
      title: "台積電還能買嗎？新手請教",
      text: "最近想開始存股，台積電現在這個價位進場會不會太高？請大家給點意見。",
      site: "mobile01.com",
      url: "https://www.mobile01.com/topicdetail.php?f=291&t=9000006",
    }
  ),
  sample(TextSpeaker.Investor, NewsChannel.Social, "a social post", {
    title: "台積電今天又被外資倒貨，散戶要怎麼辦",
    text: "外資連三天賣超台積電，我的部位已經套了一成，大家都怎麼應對？",
    site: "threads.com",
    url: "https://www.threads.com/@retail_investor/post/DAbCdEfGhIj",
  }),
  sample(
    TextSpeaker.Investor,
    NewsChannel.Social,
    "a social post in English",
    {
      title: "$AAPL loading more calls before earnings",
      text: "$AAPL loading more calls before earnings, this one is going to rip",
      site: "x.com",
      url: "https://x.com/retail_trader/status/1900000000000000000",
    },
    APPLE
  ),
  sample(
    TextSpeaker.Reference,
    NewsChannel.Article,
    "a data page on a forum's site",
    {
      title:
        "台積電(2330)毛利率查詢｜歷年毛利率、營益率與淨利率分析 - 股市爆料同學會",
      text: "台積電毛利率、營業利益率、稅後淨利率歷年走勢圖表與季度數據。",
      site: "cmoney.tw",
      url: "https://www.cmoney.tw/forum/stock/2330?s=stockfindetail",
    }
  ),
  sample(TextSpeaker.Reference, NewsChannel.Article, "a quote page", {
    title: "台積電(2330.TW) 走勢圖 - Yahoo奇摩股市",
    text: "成交 1,035 漲跌 +15 開盤 1,020 最高 1,040 最低 1,018 成交量 25,380 張",
    site: "tw.stock.yahoo.com",
    url: "https://tw.stock.yahoo.com/quote/2330.TW",
  }),
  sample(TextSpeaker.Reference, NewsChannel.Article, "a company profile", {
    title: "台積電(2330) 個股概覽 | 基本資料",
    text: "公司名稱：台灣積體電路製造股份有限公司 產業別：半導體業 成立日期：1987 實收資本額",
    site: "cmoney.tw",
    url: "https://www.cmoney.tw/forum/stock/2330?s=basic",
  }),
  sample(
    TextSpeaker.Reference,
    NewsChannel.Article,
    "a quote page in English",
    {
      title: "Apple Inc. (AAPL) Stock Price, News, Quote",
      text: "Previous Close 228.10 Open 229.00 Day's Range 227.50 - 231.20 Market Cap 3.4T",
      site: "finance.yahoo.com",
      url: "https://finance.yahoo.com/quote/AAPL/",
    },
    APPLE
  ),
  sample(
    TextSpeaker.Outlet,
    NewsChannel.Social,
    "an outlet's own account on a social network",
    {
      title: "鉅亨速報：台積電十月營收創新高",
      text: "鉅亨網新聞：台積電今日公布十月營收，較去年同期成長四成，創單月新高。",
      site: "threads.com",
      url: "https://www.threads.com/@cnyes_news/post/DBcDeFgHiJk",
    }
  ),
  sample(
    TextSpeaker.Outlet,
    NewsChannel.Article,
    "a broker's daily flow report",
    {
      title: "三大法人買賣超 外資賣超台積電3萬張",
      text: "外資今日賣超台積電3萬張，投信則連續五日買超，自營商小幅調節。",
      site: "sinotrade.com.tw",
      url: "https://www.sinotrade.com.tw/richclub/news/9000010",
    }
  ),
  sample(
    TextSpeaker.Outlet,
    NewsChannel.Article,
    "an outlet reports what a forum says",
    {
      title: "PTT股板熱議台積電除息 網友：存股族最愛",
      text: "台積電今日除息，PTT股票板湧入大量討論，不少網友表示會繼續存股。",
      site: "ettoday.net",
      url: "https://www.ettoday.net/news/20261016/9000011.htm",
    }
  ),
  sample(
    TextSpeaker.Investor,
    NewsChannel.Forum,
    "a whole article reposted on a forum",
    {
      title: "[新聞] 台積電十月營收創新高 年增四成",
      text: "1.原文連結：https://news.test/9000012 2.原文內容：台積電今日公布十月營收，較去年同期成長四成。3.心得/評論：營收這麼好，明天開高走高吧。",
      site: "ptt.cc",
      url: "https://www.ptt.cc/bbs/Stock/M.1760000200.A.123.html",
    }
  ),
  sample(TextSpeaker.Investor, NewsChannel.Article, "an individual's blog", {
    title: "我的存股日記：為什麼我又加碼台積電",
    text: "這是我存股的第五年，這篇記錄我這個月加碼台積電的理由和持股比例。",
    site: "vocus.cc",
    url: "https://vocus.cc/article/9000013",
  }),
  sample(
    TextSpeaker.Investor,
    NewsChannel.Article,
    "a question on a discussion site",
    {
      title: "台積電現在可以進場了嗎",
      text: "剛出社會想開始投資，看大家都說台積電，現在進場會不會太晚？",
      site: "dcard.tw",
      url: "https://www.dcard.tw/f/money/p/9000014",
    }
  ),
  sample(
    TextSpeaker.Reference,
    NewsChannel.Article,
    "a stock quote on the company's own site",
    {
      title: "台積電 投資人關係 - 股價資訊",
      text: "股價 1,035 漲跌 +15 成交量 25,380 張 本益比 22.4",
      site: "investor.tsmc.com",
      url: "https://investor.tsmc.com/chinese/stock-quote",
    }
  ),
  sample(
    TextSpeaker.Reference,
    NewsChannel.Article,
    "daily trading data the exchange publishes",
    {
      title: "個股日成交資訊 2330 台積電",
      text: "日期 成交股數 成交金額 開盤價 最高價 最低價 收盤價 115/10/01 25,380,000 26,268,300,000 1,020 1,040 1,018 1,035",
      site: "twse.com.tw",
      url: "https://www.twse.com.tw/zh/trading/historical/stock-day.html",
    }
  ),
  sample(TextSpeaker.Reference, NewsChannel.Article, "a list of headlines", {
    title: "台積電 相關新聞 - 鉅亨網",
    text: "台積電法說會釋利多｜外資上修目標價｜台積電十月營收創新高｜先進封裝產能吃緊",
    site: "news.cnyes.com",
    url: "https://news.cnyes.com/tag/2330",
  }),
  sample(TextSpeaker.Other, NewsChannel.Article, "the exchange's own notice", {
    title: "臺灣證券交易所公告台積電現金增資新股上市買賣",
    text: "本公司公告台灣積體電路製造股份有限公司現金增資發行新股，自民國115年11月20日起上市買賣。",
    site: "twse.com.tw",
    url: "https://www.twse.com.tw/zh/announcement/9000008",
  }),
  sample(
    TextSpeaker.Other,
    NewsChannel.Article,
    "a regulator's own release",
    {
      title: "FTC sues Apple over App Store payment rules",
      text: "The Federal Trade Commission today filed a complaint alleging that Apple's payment rules harm developers and consumers.",
      site: "ftc.gov",
      url: "https://www.ftc.gov/news-events/news/press-releases/2026/10/9000009",
    },
    APPLE
  ),
];
