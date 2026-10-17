import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";

import { createSitca } from "../src/sitca.ts";

const SITCA = "https://www.sitca.org.tw/MemberK0000/F/03/";

const NAV_URL = `${SITCA}nav.csv`;

const COSTS_URL = new URL("46443投信投顧公會境內基金各項費用資料.csv", SITCA)
  .href;

const NAV_HEADER =
  "日期,會員代號,公司名稱,基金統編,基金代號,基金名稱,基金淨值,漲跌,漲跌幅,類型代號,幣別,受益憑證代號";

const COSTS_HEADER =
  "年月,類型代號,基金統編,基金代號,會員代號,公司名稱,基金名稱,月手續費,月手續費_比率,月交易稅,月交易稅_比率,月經理費,月經理費_比率,月保管費,月保管費_比率,月保證費,月保證費_比率,月其他費用,月其他費用_比率,合計,合計_比率";

/** A file as SITCA serves it: a byte order mark, lines ending in CRLF and a header naming each field. */
const file = (header: string, lines: string[]) =>
  `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;

/**
 * Answers each file with what is given for its address, as an octet stream, refusing a request
 * that accepts only text as SITCA does.
 */
function fakeSitca(files: Record<string, string | Response> = {}) {
  const sent: string[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);

    sent.push(request.url);

    if (request.headers.get("accept")?.startsWith("text/")) {
      return new Response("Not Acceptable", { status: 406 });
    }

    const answer = files[request.url];

    if (answer instanceof Response) return answer;

    if (answer === undefined) return new Response("", { status: 404 });

    return new Response(answer, {
      headers: { "content-type": "application/octet-stream" },
    });
  };

  return { sent, sitca: createSitca({ fetch }) };
}

const NAVS = file(NAV_HEADER, [
  "20261016,A0005,範例投信,98764389,DDE02,範例台灣卓越50基金,108.62,0.5,0.46,AH11,TWD,0050",
  // A class of a fund whose tax id carries the class's letter.
  "20261015,A0037,範例投信,42482726A,DIE09,範例美國公債指數基金-新台幣,26.7681,-0.1,-0.37,AH22,TWD,00687B",
  // The same fund's class priced in dollars.
  "20261015,A0037,範例投信,42482726B,DIE10,範例美國公債指數基金-美元,0.8412,0,0,AH22,USD,00687C",
  // An unlisted fund, whose units carry a code that is no listing's.
  "20261016,A0001,範例投信,00526748A,DIOB2,範例多重資產基金-累積型,13.2,-0.14,-1.04,AJ2,TWD,T0138A",
  // A fund listed this month, which has no month of costs yet.
  "20261016,A0016,範例投信,00512999,DDE88,範例台灣核心50主動式ETF基金,10.12,0.02,0.2,AL11,TWD,00415A",
  // A value that does not read.
  "20261016,A0016,範例投信,42481260,DDE03,範例臺灣加權單日反向1倍基金,--,0,0,AH13,TWD,00632R",
  // More fields than the header names, as a name with a comma in it would make.
  "20261016,A0010,範例投信,48975156,DDE04,範例台灣,摩根基金,90.1,0.3,0.33,AH11,TWD,0057",
]);

test("reads the newest net asset value of every listed fund, in the market's currency", async () => {
  const { sent, sitca } = fakeSitca({ [NAV_URL]: NAVS });

  expect(await sitca.getNetAssetValues(Market.TW)).toEqual([
    { symbol: "0050", date: "2026-10-16", value: 108.62 },
    { symbol: "00687B", date: "2026-10-15", value: 26.7681 },
    { symbol: "00415A", date: "2026-10-16", value: 10.12 },
  ]);
  expect(sent).toEqual([NAV_URL]);
});

test("pairs each listed fund with what it paid over the newest month by the fund's tax id", async () => {
  const { sent, sitca } = fakeSitca({
    [NAV_URL]: NAVS,
    [COSTS_URL]: file(COSTS_HEADER, [
      "202609,AH11,98764389,DDE02,A0005,範例投信,範例台灣卓越50基金,13408170,0.00055,34765250,0.00144,136400146,0.00564,53816509,0.00222,0,0.00000,95823935,0.00396,334214010,0.01382",
      // One row for a fund of several classes, under its tax id without a class's letter.
      "202609,AH22,42482726,DIE09,A0037,範例投信,範例美國公債指數基金,0,0.00000,0,0.00000,9352138,0.00824,3740851,0.00330,0,0.00000,1332201,0.00117,14425190,0.01272",
      // An unlisted fund's, which no listing reads.
      "202609,AJ2,00526748,DIOB2,A0001,範例投信,範例多重資產基金,0,0.00000,0,0.00000,100,0.10000,10,0.01000,0,0.00000,5,0.00500,115,0.11500",
    ]),
  });

  expect(await sitca.getCosts(Market.TW)).toEqual([
    {
      symbol: "0050",
      month: "2026-09",
      management: 0.00564,
      custody: 0.00222,
      guarantee: 0,
      commission: 0.00055,
      tax: 0.00144,
      other: 0.00396,
      total: 0.01382,
    },
    {
      symbol: "00687B",
      month: "2026-09",
      management: 0.00824,
      custody: 0.0033,
      guarantee: 0,
      commission: 0,
      tax: 0,
      other: 0.00117,
      total: 0.01272,
    },
    // The class priced in dollars is the same fund, so it costs what the fund did.
    {
      symbol: "00687C",
      month: "2026-09",
      management: 0.00824,
      custody: 0.0033,
      guarantee: 0,
      commission: 0,
      tax: 0,
      other: 0.00117,
      total: 0.01272,
    },
  ]);
  expect(sent.toSorted()).toEqual([COSTS_URL, NAV_URL].toSorted());
});

test("fails when none of a file's rows read, rather than answer that no fund reports", async () => {
  const { sitca } = fakeSitca({
    [NAV_URL]: "<html>\r\n<body>維護中</body>\r\n</html>\r\n",
  });

  await expect(sitca.getNetAssetValues(Market.TW)).rejects.toThrow(
    "SITCA: none of the 2 rows of nav.csv read as expected"
  );
});

test("names SITCA and the status it answered when it refuses", async () => {
  const { sitca } = fakeSitca({
    [NAV_URL]: new Response("", { status: 503 }),
  });

  await expect(sitca.getNetAssetValues(Market.TW)).rejects.toThrow(
    "SITCA answered 503"
  );
});

test("outside Taiwan there is nothing to read, and it costs no request", async () => {
  const { sent, sitca } = fakeSitca();

  expect(await sitca.getNetAssetValues(Market.US)).toEqual([]);
  expect(await sitca.getCosts(Market.US)).toEqual([]);
  expect(sent).toEqual([]);
});
