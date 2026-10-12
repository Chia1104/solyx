import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";

import { createInsiderTransfers } from "../src/insider-transfers.ts";

const transfer = (fields: Record<string, string>) => ({
  姓名: "王小明",
  "預定轉讓方式及股數-轉讓方式": " 一般交易(每日得轉讓股數限制)",
  "預定轉讓方式及股數-轉讓股數": " 3000000",
  每日於盤中交易最大得轉讓股數: "849245",
  受讓人: "",
  "目前持有股數-自有持股": "18125000",
  "目前持有股數-保留運用決定權信託股數": "0",
  "預定轉讓總股數-自有持股": "3000000",
  "預定轉讓總股數-保留運用決定權信託股數": "0",
  "預定轉讓後持股-自有持股": "15125000",
  "預定轉讓後持股-保留運用決定權信託股數": "0",
  有效轉讓期間: "1151011~1151110",
  ...fields,
});

const TWSE_ROWS = [
  transfer({
    出表日期: "1151008",
    公司代號: "2330",
    公司名稱: "範例電子",
    申報人身分: "經理人本人",
  }),
  // Shares held in trust count with the declarer's own.
  transfer({
    出表日期: "1151007",
    公司代號: "2330",
    公司名稱: "範例電子",
    申報人身分: "董事本人",
    姓名: "陳大文",
    "預定轉讓方式及股數-轉讓方式": "贈與",
    "預定轉讓方式及股數-轉讓股數": "",
    受讓人: "陳小文",
    "目前持有股數-自有持股": "1000000",
    "目前持有股數-保留運用決定權信託股數": "500000",
    "預定轉讓總股數-自有持股": "100000",
    "預定轉讓總股數-保留運用決定權信託股數": "50000",
    "預定轉讓後持股-自有持股": "900000",
    "預定轉讓後持股-保留運用決定權信託股數": "450000",
    有效轉讓期間: "1151007~1151009",
  }),
  transfer({
    出表日期: "1151008",
    公司代號: "2317",
    公司名稱: "別家公司",
    申報人身分: "大股東本人",
  }),
  // A count that is no number is not read.
  transfer({
    出表日期: "1151008",
    公司代號: "2330",
    申報人身分: "董事本人",
    "預定轉讓總股數-自有持股": "若干",
  }),
];

const TPEX_ROWS = [
  transfer({
    Date: "1151008",
    SecuritiesCompanyCode: "7642",
    CompanyName: "範例機電",
    申請人身分: "董事配偶",
    "預定轉讓方式及股數-轉讓方式": "洽特定人",
    受讓人: "範例投資股份有限公司",
  }),
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

const TSMC = { market: Market.TW, symbol: "2330" };

test("finds the transfers a listed company's insiders declared, newest first, each by its day on Taipei's calendar", async () => {
  const items = await createInsiderTransfers(fakeFeeds()).search({
    symbol: TSMC,
    listing: null,
    since: new Date("2026-10-01T00:00:00Z"),
    limit: 10,
  });

  expect(items).toEqual([
    {
      id: "2330:2026-10-08:王小明:一般交易(每日得轉讓股數限制):3000000::18125000",
      url: null,
      title:
        "內部人持股轉讓事前申報：經理人本人 王小明，一般交易(每日得轉讓股數限制) 3,000,000 股",
      snippet:
        "目前持有股數 18,125,000；預定轉讓總股數 3,000,000；預定轉讓後持股 15,125,000；有效轉讓期間 1151011~1151110",
      site: "mops.twse.com.tw",
      // The start of 2026-10-08 in Taipei
      published: {
        at: new Date("2026-10-07T16:00:00Z"),
        precision: TimePrecision.Day,
      },
      votes: null,
    },
    {
      id: "2330:2026-10-07:陳大文:贈與:150000:陳小文:1500000",
      url: null,
      title: "內部人持股轉讓事前申報：董事本人 陳大文，贈與 150,000 股",
      snippet:
        "目前持有股數 1,500,000；預定轉讓總股數 150,000；預定轉讓後持股 1,350,000；受讓人 陳小文；有效轉讓期間 1151007~1151009",
      site: "mops.twse.com.tw",
      published: {
        at: new Date("2026-10-06T16:00:00Z"),
        precision: TimePrecision.Day,
      },
      votes: null,
    },
  ]);
});

test("finds an OTC company's in TPEx's feed, which names who declares another way", async () => {
  const items = await createInsiderTransfers(fakeFeeds()).search({
    symbol: { market: Market.TW, symbol: "7642" },
    listing: null,
    since: new Date("2026-10-01T00:00:00Z"),
    limit: 10,
  });

  expect(items.map((item) => item.title)).toEqual([
    "內部人持股轉讓事前申報：董事配偶 王小明，洽特定人 3,000,000 股",
  ]);
});

test("leaves out declarations before the range, and keeps to the limit", async () => {
  const source = createInsiderTransfers(fakeFeeds());

  const recent = await source.search({
    symbol: TSMC,
    listing: null,
    since: new Date("2026-10-07T16:00:00Z"),
    limit: 10,
  });

  const newest = await source.search({
    symbol: TSMC,
    listing: null,
    since: new Date("2026-10-01T00:00:00Z"),
    limit: 1,
  });

  expect(recent.map(({ id }) => id)).toEqual(newest.map(({ id }) => id));
  expect(recent).toHaveLength(1);
});
