import { expect, test } from "vite-plus/test";

import { RestrictionKind } from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";

import { createTwExchanges } from "../src/tw-exchanges.ts";

const TWSE = "https://openapi.twse.com.tw/v1/";

const TPEX = "https://www.tpex.org.tw/openapi/v1/";

/** Answers each list with what is given for its address, and with no rows for one not given. */
function fakeExchanges(lists: Record<string, object[] | Response> = {}) {
  const sent: string[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const { url } = new Request(input, init);

    sent.push(url);

    const answer = lists[url] ?? [];

    return answer instanceof Response ? answer : Response.json(answer);
  };

  return { sent, exchanges: createTwExchanges({ fetch }) };
}

test("reads both exchanges' lists into one market's restrictions, oldest first", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/BFI84U`]: [
      {
        Code: "2330",
        Name: "台積電",
        StartDate: "1151008",
        EndDate: "1151014",
        Reason: "除息",
      },
      // No last day set.
      {
        Code: "2317",
        Name: "鴻海",
        StartDate: "1151009",
        EndDate: "",
        Reason: "減資",
      },
    ],
    [`${TWSE}exchangeReport/TWTBAU1`]: [
      {
        Code: "2330",
        Name: "台積電",
        StartDate: "1151012",
        EndDate: "1151016",
        Reason: "除息",
      },
    ],
    [`${TWSE}announcement/punish`]: [
      {
        Number: "1",
        Date: "1151007",
        Code: "2454",
        Name: "聯發科",
        NumberOfAnnouncement: "1",
        ReasonsOfDisposition: "連續三次",
        DispositionPeriod: "115/10/08～115/10/15",
        DispositionMeasures: "第一次處置",
        Detail: "１處置原因：…",
        LinkInformation: "…",
      },
    ],
    [`${TWSE}exchangeReport/TWTAWU`]: [
      {
        Number: "1",
        Code: "2303",
        Name: "聯電",
        TradingHaltDate: "1151013",
        TradingHaltTime: "080000",
        TradingResumptionDate: "1151014",
        TradingResumptionTime: "080000",
      },
    ],
    [`${TPEX}tpex_margin_trading_term`]: [
      {
        Date: "1151012",
        SecuritiesCompanyCode: "00679B",
        CompanyName: "元大美債20年",
        ShortSaleSuspensionStartDate: "1151013",
        ShortSaleSuspensionEndDate: "1151016",
        Reason: "",
      },
    ],
    [`${TPEX}tpex_intraday_trading_pre`]: [
      // TPEx pads names, and names the day day trading is allowed again.
      {
        Date: "1151008",
        SecuritiesCompanyCode: "6488",
        CompanyName: "環球晶          ",
        FirstDayToSuspendSellThenBuy: "1151012",
        DayOfReinstatingSellThenBuy: "1151019",
        " Reason": "除息",
      },
    ],
    [`${TPEX}tpex_disposal_information`]: [
      {
        Date: "1151008",
        SecuritiesCompanyCode: "5483",
        CompanyName: "中美晶",
        DispositionPeriod: "1151012~1151016",
        DispositionReasons: "連續3個營業日",
        DisposalCondition: "* 公布日期：…",
      },
    ],
    [`${TPEX}tpex_spendi_history`]: [
      {
        Date: "115",
        Serial: "1",
        SecuritiesCompanyCode: "3293",
        CompanyName: "鈊象",
        DateOfSuspendedTrading: "1150618",
        TimeOfSuspendedTrading: "080000",
        DateOfResumedTrading: "",
        TimeOfResumedTrading: "",
      },
      {
        Date: "115",
        Serial: "2",
        SecuritiesCompanyCode: "3293",
        CompanyName: "鈊象",
        DateOfSuspendedTrading: "",
        TimeOfSuspendedTrading: "",
        DateOfResumedTrading: "1150622",
        TimeOfResumedTrading: "080000",
      },
      // Not resumed yet.
      {
        Date: "115",
        Serial: "3",
        SecuritiesCompanyCode: "8069",
        CompanyName: "元太",
        DateOfSuspendedTrading: "1151014",
        TimeOfSuspendedTrading: "080000",
        DateOfResumedTrading: "",
        TimeOfResumedTrading: "",
      },
    ],
  });

  expect(await exchanges.getRestrictions(Market.TW)).toEqual([
    // Halted through the day before trading resumed.
    {
      symbol: "3293",
      kind: RestrictionKind.Halt,
      from: "2026-06-18",
      until: "2026-06-21",
      note: null,
    },
    {
      symbol: "2330",
      kind: RestrictionKind.ShortSaleSuspension,
      from: "2026-10-08",
      until: "2026-10-14",
      note: "除息",
    },
    {
      symbol: "2454",
      kind: RestrictionKind.Disposition,
      from: "2026-10-08",
      until: "2026-10-15",
      note: "第一次處置：連續三次",
    },
    {
      symbol: "2317",
      kind: RestrictionKind.ShortSaleSuspension,
      from: "2026-10-09",
      until: null,
      note: "減資",
    },
    {
      symbol: "2330",
      kind: RestrictionKind.DayTradingSuspension,
      from: "2026-10-12",
      until: "2026-10-16",
      note: "除息",
    },
    {
      symbol: "6488",
      kind: RestrictionKind.DayTradingSuspension,
      from: "2026-10-12",
      until: "2026-10-18",
      note: "除息",
    },
    {
      symbol: "5483",
      kind: RestrictionKind.Disposition,
      from: "2026-10-12",
      until: "2026-10-16",
      note: "連續3個營業日",
    },
    // Resumed the day after it began.
    {
      symbol: "2303",
      kind: RestrictionKind.Halt,
      from: "2026-10-13",
      until: "2026-10-13",
      note: null,
    },
    {
      symbol: "00679B",
      kind: RestrictionKind.ShortSaleSuspension,
      from: "2026-10-13",
      until: "2026-10-16",
      note: null,
    },
    {
      symbol: "8069",
      kind: RestrictionKind.Halt,
      from: "2026-10-14",
      until: null,
      note: null,
    },
  ]);
  expect(sent.toSorted()).toEqual([
    `${TWSE}announcement/punish`,
    `${TWSE}exchangeReport/BFI84U`,
    `${TWSE}exchangeReport/TWTAWU`,
    `${TWSE}exchangeReport/TWTBAU1`,
    `${TPEX}tpex_disposal_information`,
    `${TPEX}tpex_intraday_trading_pre`,
    `${TPEX}tpex_margin_trading_term`,
    `${TPEX}tpex_spendi_history`,
  ]);
});

test("a list that answers one row with no code has nothing on it", async () => {
  const { exchanges } = fakeExchanges({
    [`${TWSE}announcement/punish`]: [
      {
        Number: "0",
        Date: "",
        Code: "",
        Name: "",
        ReasonsOfDisposition: "",
        DispositionPeriod: "",
        DispositionMeasures: "",
      },
    ],
  });

  expect(await exchanges.getRestrictions(Market.TW)).toEqual([]);
});

test("a row that does not read is dropped, and the list's others stay", async () => {
  const { exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/TWTBAU1`]: [
      { Code: "2330", StartDate: "1151012", EndDate: "1151016", Reason: "" },
      { Code: "2317", StartDate: "1151332", EndDate: "1151016", Reason: "" },
    ],
  });

  expect(await exchanges.getRestrictions(Market.TW)).toEqual([
    {
      symbol: "2330",
      kind: RestrictionKind.DayTradingSuspension,
      from: "2026-10-12",
      until: "2026-10-16",
      note: null,
    },
  ]);
});

test("fails when none of a list's rows read, rather than answer that nothing is restricted", async () => {
  const { exchanges } = fakeExchanges({
    [`${TPEX}tpex_disposal_information`]: [
      { SecuritiesCompanyCode: "5483", 處置期間: "1151012~1151016" },
    ],
  });

  await expect(exchanges.getRestrictions(Market.TW)).rejects.toThrow(
    "TPEx: none of the 1 rows of tpex_disposal_information read as expected"
  );
});

test("a failure names the exchange and the status it answered", async () => {
  const { exchanges } = fakeExchanges({
    [`${TPEX}tpex_spendi_history`]: new Response(null, { status: 404 }),
  });

  await expect(exchanges.getRestrictions(Market.TW)).rejects.toThrow(
    "TPEx answered 404"
  );
});

test("an answer that is no list of rows fails under the exchange's name", async () => {
  const { exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/BFI84U`]: new Response("<html>維護中</html>"),
  });

  await expect(exchanges.getRestrictions(Market.TW)).rejects.toThrow(
    "TWSE: exchangeReport/BFI84U did not answer a list of rows"
  );
});

/** A row of TWSE's list of funds, with the fields this module reads and some it does not. */
const fund = (fields: Record<string, string>) => ({
  出表日期: "1150928",
  基金代號: "0050",
  基金簡稱: "範例台灣50",
  基金類型: "國內成分證券指數股票型基金",
  基金中文名稱: "範例台灣卓越50證券投資信託基金",
  基金英文名稱: "Example Taiwan Top 50 ETF",
  "標的指數/追蹤指數名稱": "臺灣50指數",
  是否設有績效指標: "不適用",
  績效指標中文名稱: "不適用",
  是否包含國外成分股: "否",
  成立日期: "0920625",
  上市日期: "0920630",
  基金經理人: "王小明",
  "發行單位數/轉換數": "22239000000",
  備註: "",
  ...fields,
});

test("reads the funds TWSE lists, a field the exchange has nothing to say in left empty", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}opendata/t187ap47_L`]: [
      fund({}),
      // An actively managed fund tracks no index and may name a benchmark.
      fund({
        基金代號: "00981A",
        基金類型: "國內成分證券主動式交易所交易基金(股票)",
        基金中文名稱: "範例台股增長主動式ETF證券投資信託基金",
        "標的指數/追蹤指數名稱": "不適用",
        是否設有績效指標: "是",
        績效指標中文名稱: "臺灣證券交易所發行量加權股價指數",
        上市日期: "1140527",
        "發行單位數/轉換數": "9028209000",
      }),
      // Fields that do not read leave the fund its code, name and kind.
      fund({
        基金代號: "00631L",
        基金類型: "槓桿/反向指數股票型基金",
        基金中文名稱: "範例台灣50單日正向2倍證券投資信託基金",
        績效指標中文名稱: "無",
        是否包含國外成分股: "",
        上市日期: "",
        基金經理人: "NA",
        "發行單位數/轉換數": "約六十億",
      }),
    ],
  });

  expect(await exchanges.getFunds(Market.TW)).toEqual([
    {
      symbol: "0050",
      name: "範例台灣卓越50證券投資信託基金",
      category: "國內成分證券指數股票型基金",
      index: "臺灣50指數",
      benchmark: null,
      foreignHoldings: false,
      manager: "王小明",
      listedOn: "2003-06-30",
      units: 22_239_000_000,
      asOf: "2026-09-28",
    },
    {
      symbol: "00981A",
      name: "範例台股增長主動式ETF證券投資信託基金",
      category: "國內成分證券主動式交易所交易基金(股票)",
      index: null,
      benchmark: "臺灣證券交易所發行量加權股價指數",
      foreignHoldings: false,
      manager: "王小明",
      listedOn: "2025-05-27",
      units: 9_028_209_000,
      asOf: "2026-09-28",
    },
    {
      symbol: "00631L",
      name: "範例台灣50單日正向2倍證券投資信託基金",
      category: "槓桿/反向指數股票型基金",
      index: "臺灣50指數",
      benchmark: null,
      foreignHoldings: null,
      manager: null,
      listedOn: null,
      units: null,
      asOf: "2026-09-28",
    },
  ]);
  expect(sent).toEqual([`${TWSE}opendata/t187ap47_L`]);
});

test("fails when none of the funds read, rather than answer that the exchange lists none", async () => {
  const { exchanges } = fakeExchanges({
    [`${TWSE}opendata/t187ap47_L`]: [{ 基金代號: "0050", 名稱: "範例台灣50" }],
  });

  await expect(exchanges.getFunds(Market.TW)).rejects.toThrow(
    "TWSE: none of the 1 rows of opendata/t187ap47_L read as expected"
  );
});

test("reads the multiples both exchanges work out, one they work none out for left empty", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/BWIBBU_ALL`]: [
      {
        Date: "1151008",
        Code: "2330",
        Name: "台積電",
        PEratio: "29.56",
        DividendYield: "0.86",
        PBratio: "10.28",
      },
      // TWSE leaves a multiple it does not work out empty.
      {
        Date: "1151008",
        Code: "1101",
        Name: "台泥",
        PEratio: "",
        DividendYield: "",
        PBratio: "0.83",
      },
    ],
    [`${TPEX}tpex_mainboard_peratio_analysis`]: [
      // TPEx writes N/A for one.
      {
        Date: "1151012",
        SecuritiesCompanyCode: "1569",
        CompanyName: "濱川",
        PriceEarningRatio: "N/A",
        DividendPerShare: "0",
        YieldRatio: "0.00",
        PriceBookRatio: "3.58",
      },
    ],
  });

  expect(await exchanges.getMultiples(Market.TW)).toEqual([
    {
      symbol: "2330",
      asOf: "2026-10-08",
      priceToEarnings: 29.56,
      dividendYield: 0.86,
      priceToBook: 10.28,
    },
    {
      symbol: "1101",
      asOf: "2026-10-08",
      priceToEarnings: null,
      dividendYield: null,
      priceToBook: 0.83,
    },
    {
      symbol: "1569",
      asOf: "2026-10-12",
      priceToEarnings: null,
      dividendYield: 0,
      priceToBook: 3.58,
    },
  ]);
  expect(sent.toSorted()).toEqual([
    `${TWSE}exchangeReport/BWIBBU_ALL`,
    `${TPEX}tpex_mainboard_peratio_analysis`,
  ]);
});

test("fails when a list names its multiples another way, rather than answer that none is worked out", async () => {
  const { exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/BWIBBU_ALL`]: [
      {
        Date: "1151008",
        Code: "2330",
        PE: "29.56",
        Yield: "0.86",
        PB: "10.28",
      },
    ],
  });

  await expect(exchanges.getMultiples(Market.TW)).rejects.toThrow(
    "TWSE: none of the 1 rows of exchangeReport/BWIBBU_ALL read as expected"
  );
});

test("reads both exchanges' notices of shares going ex, soonest first, the cash a share only once it is announced", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/TWT48U_ALL`]: [
      // Noticed before its amount is announced.
      {
        Date: "1151021",
        Code: "0056",
        Name: "範例高股息",
        Exdividend: "息",
        StockDividendRatio: "",
        CashDividend: "",
      },
      // A stock dividend and the cash go ex on one day.
      {
        Date: "1151006",
        Code: "2614",
        Name: "東森",
        Exdividend: "權息",
        StockDividendRatio: "0.08000000",
        CashDividend: "0.400000",
      },
      // A cash capital increase goes ex no cash.
      {
        Date: "1151013",
        Code: "1727",
        Name: "中華化",
        Exdividend: "權",
        SubscriptionRatio: "0.10779602",
        SubscriptionPricePerShare: "81.0000",
        CashDividend: "0",
      },
    ],
    [`${TPEX}tpex_exright_prepost`]: [
      {
        ExRrightsExDividendDate: "1151012",
        SecuritiesCompanyCode: "00679B",
        CompanyName: "範例美債20年",
        ExRrightsExDividend: "除息",
        StockDividendRatio: "0.00000000",
        CashDividend: "0.32000000",
      },
      // TPEx says so in words where the amount is not announced.
      {
        ExRrightsExDividendDate: "1151105",
        SecuritiesCompanyCode: "5523",
        CompanyName: "豐謙",
        ExRrightsExDividend: "除息",
        StockDividendRatio: "0.00000000",
        CashDividend: "尚未公告",
      },
      {
        ExRrightsExDividendDate: "1151007",
        SecuritiesCompanyCode: "6129",
        CompanyName: "普誠",
        ExRrightsExDividend: "除權",
        StockDividendRatio: "0.00000000",
        CashDividend: "0.00000000",
      },
    ],
  });

  const notice = (
    symbol: string,
    date: string,
    exDividend: boolean,
    exRights: boolean,
    cash: number | null
  ) => ({ symbol, date, exDividend, exRights, cash });

  expect(await exchanges.getExNotices(Market.TW)).toEqual([
    notice("2614", "2026-10-06", true, true, 0.4),
    notice("6129", "2026-10-07", false, true, null),
    notice("00679B", "2026-10-12", true, false, 0.32),
    notice("1727", "2026-10-13", false, true, null),
    notice("0056", "2026-10-21", true, false, null),
    notice("5523", "2026-11-05", true, false, null),
  ]);
  expect(sent.toSorted()).toEqual([
    `${TWSE}exchangeReport/TWT48U_ALL`,
    `${TPEX}tpex_exright_prepost`,
  ]);
});

const meeting = (fields: Record<string, string>) => ({
  出表日期: "1151011",
  公司代號: "1101",
  公司名稱: "台泥",
  公司地址: "…",
  "股東常(臨時)會": "常會",
  開會日期: "1150522",
  開會地點: "…",
  是否改選董監: "否",
  是否採電子投票: "強制",
  ...fields,
});

test("reads the shareholders' meetings both exchanges list, soonest first, with whether each elects directors", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}opendata/t187ap41_L`]: [
      meeting({ "股東常(臨時)會": "臨時會", 開會日期: "1151013" }),
      meeting({ 是否改選董監: "是" }),
    ],
    [`${TPEX}t187ap41_O`]: [
      meeting({ 公司代號: "1259", 開會日期: "1150622" }),
      // A kind of meeting the exchange names another way is not read.
      meeting({ 公司代號: "1264", "股東常(臨時)會": "說明會" }),
    ],
  });

  expect(await exchanges.getMeetings(Market.TW)).toEqual([
    { symbol: "1101", date: "2026-05-22", regular: true, election: true },
    { symbol: "1259", date: "2026-06-22", regular: true, election: false },
    { symbol: "1101", date: "2026-10-13", regular: false, election: false },
  ]);
  expect(sent.toSorted()).toEqual([
    `${TWSE}opendata/t187ap41_L`,
    `${TPEX}t187ap41_O`,
  ]);
});

test("outside Taiwan there is nothing to read, and it costs no request", async () => {
  const { sent, exchanges } = fakeExchanges();

  expect(await exchanges.getRestrictions(Market.US)).toEqual([]);
  expect(await exchanges.getFunds(Market.US)).toEqual([]);
  expect(await exchanges.getMultiples(Market.US)).toEqual([]);
  expect(await exchanges.getExNotices(Market.US)).toEqual([]);
  expect(await exchanges.getMeetings(Market.US)).toEqual([]);
  expect(sent).toEqual([]);
});
