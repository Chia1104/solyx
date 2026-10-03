import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";

import { createAnnouncements } from "../src/announcements.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const TWSE_ROWS = [
  {
    出表日期: "1151003",
    發言日期: "1151002",
    發言時間: "143005",
    公司代號: "2330",
    公司名稱: "台積電",
    "主旨 ": "本公司代子公司公告\r\n取得機器設備",
    符合條款: "第20款",
    事實發生日: "1151002",
    說明: "1.標的物之名稱：機器設備\r\n2.交易數量：一批",
  },
  {
    出表日期: "1151003",
    發言日期: "1151002",
    發言時間: "70003",
    公司代號: "2330",
    公司名稱: "台積電",
    "主旨 ": "公告本公司董事會決議",
    符合條款: "第11款",
    事實發生日: "1151002",
    說明: "1.董事會決議日期：115/10/02",
  },
  {
    出表日期: "1151003",
    發言日期: "1151002",
    發言時間: "90000",
    公司代號: "2317",
    公司名稱: "鴻海",
    "主旨 ": "Someone else's",
    符合條款: "第51款",
    事實發生日: "1151002",
    說明: "",
  },
  { 公司代號: "2330", "主旨 ": "Missing its date" },
];

const TPEX_ROWS = [
  {
    Date: "1151003",
    發言日期: "1151002",
    發言時間: "164500",
    SecuritiesCompanyCode: "3105",
    CompanyName: "穩懋",
    主旨: "公告本公司財務主管異動",
    符合條款: "第8款",
    事實發生日: "1151002",
    說明: "1.人員變動別：財務主管",
  },
];

function fakeFeeds() {
  const fetch = async (input: string | URL | Request) => {
    const { hostname } = new URL(new Request(input).url);

    return Response.json(
      hostname === "openapi.twse.com.tw" ? TWSE_ROWS : TPEX_ROWS
    );
  };

  return { fetch };
}

test("finds a listed company's announcements, newest first on Taipei's clock", async () => {
  const items = await createAnnouncements(fakeFeeds()).search({
    symbol: TSMC,
    listing: null,
    since: new Date("2026-09-26T00:00:00Z"),
    limit: 10,
  });

  expect(items).toEqual([
    {
      id: "2330:1151002:143005:本公司代子公司公告\r\n取得機器設備",
      url: null,
      title: "本公司代子公司公告 取得機器設備",
      snippet: "1.標的物之名稱：機器設備\n2.交易數量：一批",
      site: "mops.twse.com.tw",
      // 14:30:05 in Taipei
      published: {
        at: new Date("2026-10-02T06:30:05Z"),
        precision: TimePrecision.Minute,
      },
      votes: null,
    },
    {
      id: "2330:1151002:70003:公告本公司董事會決議",
      url: null,
      title: "公告本公司董事會決議",
      snippet: "1.董事會決議日期：115/10/02",
      site: "mops.twse.com.tw",
      // 07:00:03 in Taipei
      published: {
        at: new Date("2026-10-01T23:00:03Z"),
        precision: TimePrecision.Minute,
      },
      votes: null,
    },
  ]);
});

test("finds an OTC company's announcements in TPEx's feed", async () => {
  const items = await createAnnouncements(fakeFeeds()).search({
    symbol: { market: Market.TW, symbol: "3105" },
    listing: null,
    since: new Date("2026-09-26T00:00:00Z"),
    limit: 10,
  });

  expect(items.map((item) => item.title)).toEqual(["公告本公司財務主管異動"]);
});

test("leaves out announcements before the range", async () => {
  const items = await createAnnouncements(fakeFeeds()).search({
    symbol: TSMC,
    listing: null,
    since: new Date("2026-10-03T00:00:00Z"),
    limit: 10,
  });

  expect(items).toEqual([]);
});
