import { expect, test } from "vite-plus/test";

import { GovernanceKind, RestrictionKind } from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";

import { createTwExchanges } from "../src/tw-exchanges.ts";

const TWSE = "https://openapi.twse.com.tw/v1/";

const TPEX = "https://www.tpex.org.tw/openapi/v1/";

/** Answers each list with what is given for its address, and with no rows for one not given. */
function fakeExchanges(
  lists: Record<string, object[] | Response> = {},
  now?: () => Date
) {
  const sent: string[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const { url } = new Request(input, init);

    sent.push(url);

    const answer = lists[url] ?? [];

    return answer instanceof Response ? answer : Response.json(answer);
  };

  return { sent, exchanges: createTwExchanges({ fetch, now }) };
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
    `${TWSE}announcement/notetrans`,
    `${TWSE}announcement/notice`,
    `${TWSE}announcement/punish`,
    `${TWSE}exchangeReport/BFI84U`,
    `${TWSE}exchangeReport/TWT85U`,
    `${TWSE}exchangeReport/TWTAWU`,
    `${TWSE}exchangeReport/TWTBAU1`,
    `${TPEX}tpex_cmode`,
    `${TPEX}tpex_disposal_information`,
    `${TPEX}tpex_intraday_trading_pre`,
    `${TPEX}tpex_margin_trading_term`,
    `${TPEX}tpex_spendi_history`,
    `${TPEX}tpex_trading_warning_information`,
    `${TPEX}tpex_trading_warning_note`,
  ]);
});

test("reads the exchanges' attention notices, the runs of them that may lead to disposition, and altered trading", async () => {
  const { exchanges } = fakeExchanges(
    {
      [`${TWSE}announcement/notice`]: [
        {
          Number: "1",
          Code: "2330",
          Name: "範例電子",
          NumberOfAnnouncement: "1",
          TradingInfoForAttention: "當日週轉率達10%(第四款)",
          Date: "1151016",
          ClosingPrice: "1000.00",
          PE: "20.00",
        },
      ],
      [`${TPEX}tpex_trading_warning_information`]: [
        {
          Date: "1151016",
          SecuritiesCompanyCode: "5483",
          CompanyName: "範例矽晶",
          TradingInformation:
            "最近六個營業日(含當日)累積之最後成交價漲幅達32%(第一款)",
          ClosePrice: "150.00",
          PriceEarningRatio: "N/A",
        },
      ],
      [`${TWSE}announcement/notetrans`]: [
        {
          Code: "2317",
          Name: "範例精密",
          RecentlyMetAttentionSecuritiesCriteria:
            "115年10月13日至115年10月16日連續四次",
        },
      ],
      // TPEx dates the list in the Gregorian calendar, so the run's own last day is read.
      [`${TPEX}tpex_trading_warning_note`]: [
        {
          Date: "20261016",
          SecuritiesCompanyCode: "6217",
          CompanyName: "範例探針",
          AccumulationSituation: "115年10月15日至115年10月16日連續二次",
        },
      ],
      [`${TWSE}exchangeReport/TWT85U`]: [
        { Code: "1213", Name: "範例飲料", PeriodicCallAuctionTrading: "  " },
        { Code: "2314", Name: "範例通訊", PeriodicCallAuctionTrading: "**" },
      ],
      [`${TPEX}tpex_cmode`]: [
        {
          Date: "1151016",
          SecuritiesCompanyCode: "3064",
          CompanyName: "範例科技",
          AlteredTrading: "Ｙ",
          PeriodicTrading: "Ｙ",
          ManagedStock: "Ｙ",
          MatchingFrequency: "",
          SuspensionOfTrading: "",
          " FinancialAnnouncements": "Ｙ",
        },
        // Halted alone, which the list of halts tells.
        {
          Date: "1151016",
          SecuritiesCompanyCode: "2067",
          CompanyName: "範例鋼鐵",
          AlteredTrading: "",
          PeriodicTrading: "",
          ManagedStock: "",
          MatchingFrequency: "",
          SuspensionOfTrading: "Ｙ",
          " FinancialAnnouncements": "Ｙ",
        },
      ],
    },
    () => new Date("2026-10-19T09:00:00+08:00")
  );

  const restriction = (
    symbol: string,
    kind: RestrictionKind,
    from: string,
    note: string | null
  ) => ({ symbol, kind, from, until: null, note });

  expect(await exchanges.getRestrictions(Market.TW)).toEqual([
    restriction(
      "2330",
      RestrictionKind.Attention,
      "2026-10-16",
      "當日週轉率達10%(第四款)"
    ),
    restriction(
      "5483",
      RestrictionKind.Attention,
      "2026-10-16",
      "最近六個營業日(含當日)累積之最後成交價漲幅達32%(第一款)"
    ),
    restriction(
      "2317",
      RestrictionKind.NearDisposition,
      "2026-10-16",
      "115年10月13日至115年10月16日連續四次"
    ),
    restriction(
      "6217",
      RestrictionKind.NearDisposition,
      "2026-10-16",
      "115年10月15日至115年10月16日連續二次"
    ),
    restriction(
      "3064",
      RestrictionKind.AlteredTrading,
      "2026-10-16",
      "分盤交易、管理股票"
    ),
    restriction("1213", RestrictionKind.AlteredTrading, "2026-10-19", null),
    restriction(
      "2314",
      RestrictionKind.AlteredTrading,
      "2026-10-19",
      "分盤交易"
    ),
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

/** A row of TWSE's list of the last session's trading; one that did not trade is on it with no volume. */
const listing = (code: string, volume = "1000") => ({
  Date: "1151016",
  Code: code,
  Name: `範例${code}`,
  TradeVolume: volume,
  ClosingPrice: volume === "" ? "" : "100.00",
});

test("reads the funds TWSE lists, a field the exchange has nothing to say in left empty", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/STOCK_DAY_ALL`]: [
      listing("0050"),
      listing("00981A"),
      listing("00631L", ""),
      listing("2330"),
    ],
    [`${TWSE}opendata/t187ap47_L`]: [
      fund({}),
      // Delisted, which the list of funds still holds.
      fund({ 基金代號: "0054", 基金中文名稱: "範例台商50證券投資信託基金" }),
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
  expect(sent.toSorted()).toEqual([
    `${TWSE}exchangeReport/STOCK_DAY_ALL`,
    `${TWSE}opendata/t187ap47_L`,
  ]);
});

test("fails when TWSE's list of the last session's trading holds nothing, rather than answer that it lists no fund", async () => {
  const { exchanges } = fakeExchanges({
    [`${TWSE}opendata/t187ap47_L`]: [fund({})],
  });

  await expect(exchanges.getFunds(Market.TW)).rejects.toThrow(
    "TWSE: exchangeReport/STOCK_DAY_ALL listed nothing"
  );
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

test("reads the weekdays TWSE closes the market, leaving out weekends and the trading days it names around a holiday", async () => {
  const day = (Date: string, Name: string, Weekday: string) => ({
    Name,
    Date,
    Weekday,
    Description: "…",
  });

  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}holidaySchedule/holidaySchedule`]: [
      day("1150211", "農曆春節前最後交易日", "三"),
      day("1150212", "市場無交易，僅辦理結算交割作業", "四"),
      day("1150215", "農曆除夕及春節", "日"),
      day("1150216", "農曆除夕及春節", "一"),
      day("1150223", "農曆春節後開始交易日", "一"),
      day("1151009", "國慶日", "五"),
      day("1151010", "國慶日", "六"),
    ],
  });

  expect(await exchanges.getClosures(Market.TW)).toEqual([
    {
      market: Market.TW,
      date: "2026-02-12",
      name: "市場無交易，僅辦理結算交割作業",
    },
    { market: Market.TW, date: "2026-02-16", name: "農曆除夕及春節" },
    { market: Market.TW, date: "2026-10-09", name: "國慶日" },
  ]);
  expect(sent).toEqual([`${TWSE}holidaySchedule/holidaySchedule`]);
});

test("reads both exchanges' companies, each with its industry by the exchanges' code and name and the shares it issued", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}opendata/t187ap03_L`]: [
      {
        出表日期: "1151011",
        公司代號: "2330",
        公司名稱: "範例電子",
        產業別: "24",
        已發行普通股數或TDR原股發行股數: "25932370067",
      },
      // A code the exchanges add later reads by the code alone, and a count written otherwise as none.
      {
        出表日期: "1151011",
        公司代號: "9999",
        公司名稱: "範例新業",
        產業別: "39",
        已發行普通股數或TDR原股發行股數: "－",
      },
    ],
    [`${TPEX}mopsfin_t187ap03_O`]: [
      {
        Date: "1151011",
        SecuritiesCompanyCode: "5483",
        CompanyName: "範例矽晶",
        SecuritiesIndustryCode: "24",
        IssueShares: "586337000",
      },
      // A depositary receipt's count is its foreign issuer's shares, not its receipts.
      {
        Date: "1151011",
        SecuritiesCompanyCode: "910322",
        CompanyName: "範例存託",
        SecuritiesIndustryCode: "91",
        IssueShares: "10450002831",
      },
    ],
  });

  const chips = { code: "24", name: "半導體業" };

  expect(await exchanges.getCompanies(Market.TW)).toEqual([
    { symbol: "2330", industry: chips, shares: 25_932_370_067 },
    { symbol: "9999", industry: { code: "39", name: "39" }, shares: null },
    { symbol: "5483", industry: chips, shares: 586_337_000 },
    {
      symbol: "910322",
      industry: { code: "91", name: "存託憑證" },
      shares: null,
    },
  ]);
  expect(sent.toSorted()).toEqual([
    `${TWSE}opendata/t187ap03_L`,
    `${TPEX}mopsfin_t187ap03_O`,
  ]);
});

test("reads the limits both exchanges set for the next session, a listing without limits among them", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/TWT84U`]: [
      {
        Code: "2330",
        Name: "範例電子",
        TodayLimitUp: "1070.00",
        TodayOpeningRefPrice: "975.00",
        TodayLimitDown: "880.00",
        PreviousDayOpeningRefPrice: "970.00",
        PreviousDayPrice: "975.00",
        PreviousDayLimitUp: "975.00",
        PreviousDayLimitDown: "980.00",
        LastTradingDay: "1151016",
        AllowOddLotTrade: "可",
      },
      // Last traded long before, yet its limits are for the same session.
      {
        Code: "2887Z1",
        Name: "範例特",
        TodayLimitUp: "25.30",
        TodayOpeningRefPrice: "23.00",
        TodayLimitDown: "20.70",
        LastTradingDay: "1141231",
      },
      // A fund of foreign shares trades without limits.
      {
        Code: "00999A",
        Name: "範例美國科技",
        TodayLimitUp: "9999.95",
        TodayOpeningRefPrice: "9.85",
        TodayLimitDown: "0.01",
        LastTradingDay: "1151016",
      },
      // A warrant is no listing an order here names.
      {
        Code: "053040",
        Name: "範例購01",
        TodayLimitUp: "1.20",
        TodayOpeningRefPrice: "0.80",
        TodayLimitDown: "0.40",
        LastTradingDay: "1151016",
      },
    ],
    [`${TPEX}tpex_mainboard_daily_close_quotes`]: [
      {
        Date: "1151016",
        SecuritiesCompanyCode: "5483",
        CompanyName: "範例矽晶",
        Close: "150.00",
        NextReferencePrice: "150.00",
        NextLimitUp: "165.00",
        NextLimitDown: "135.00",
      },
      {
        Date: "1151016",
        SecuritiesCompanyCode: "712345",
        CompanyName: "範例購02",
        Close: "0.50",
        NextReferencePrice: "0.50",
        NextLimitUp: "0.95",
        NextLimitDown: "0.05",
      },
    ],
  });

  expect(await exchanges.getPriceLimits(Market.TW)).toEqual([
    {
      symbol: "2330",
      after: "2026-10-16",
      band: { low: 880, high: 1070 },
    },
    {
      symbol: "2887Z1",
      after: "2026-10-16",
      band: { low: 20.7, high: 25.3 },
    },
    { symbol: "00999A", after: "2026-10-16", band: null },
    {
      symbol: "5483",
      after: "2026-10-16",
      band: { low: 135, high: 165 },
    },
  ]);
  expect(sent.toSorted()).toEqual([
    `${TWSE}exchangeReport/TWT84U`,
    `${TPEX}tpex_mainboard_daily_close_quotes`,
  ]);
});

test("reads every listing's name from both exchanges' quotes of their last session, warrants aside", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/STOCK_DAY_ALL`]: [
      {
        Date: "1151016",
        Code: "2330",
        Name: "範例電子",
        ClosingPrice: "2420.00",
      },
      // A listing that did not trade keeps its name.
      { Date: "1151016", Code: "0050", Name: "範例台灣50", ClosingPrice: "" },
      {
        Date: "1151016",
        Code: "053040",
        Name: "範例購01",
        ClosingPrice: "0.80",
      },
    ],
    [`${TPEX}tpex_mainboard_daily_close_quotes`]: [
      // TPEx pads names.
      {
        Date: "1151016",
        SecuritiesCompanyCode: "5483",
        CompanyName: "範例矽晶   ",
        Close: "150.00",
      },
      {
        Date: "1151016",
        SecuritiesCompanyCode: "712345",
        CompanyName: "範例購02",
        Close: "0.50",
      },
    ],
  });

  expect(await exchanges.getListingNames(Market.TW)).toEqual([
    { symbol: "2330", name: "範例電子" },
    { symbol: "0050", name: "範例台灣50" },
    { symbol: "5483", name: "範例矽晶" },
  ]);
  expect(await exchanges.getListingNames(Market.US)).toEqual([]);
  expect(sent.toSorted()).toEqual([
    `${TWSE}exchangeReport/STOCK_DAY_ALL`,
    `${TPEX}tpex_mainboard_daily_close_quotes`,
  ]);
});

test("reads the closes of TWSE's last session, leaving out a listing that did not trade", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}exchangeReport/STOCK_DAY_ALL`]: [
      {
        Date: "1151016",
        Code: "2330",
        Name: "範例電子",
        TradeVolume: "43046982",
        TradeValue: "104583063462",
        OpeningPrice: "2430.00",
        HighestPrice: "2445.00",
        LowestPrice: "2420.00",
        ClosingPrice: "2420.00",
        Change: "-20.0000",
        Transaction: "400499",
      },
      {
        Date: "1151016",
        Code: "9999",
        Name: "範例未成交",
        TradeVolume: "0",
        TradeValue: "0",
        OpeningPrice: "",
        HighestPrice: "",
        LowestPrice: "",
        ClosingPrice: "",
        Change: "",
        Transaction: "0",
      },
    ],
  });

  expect(await exchanges.getSectorCloses(Market.TW)).toEqual([
    { symbol: "2330", date: "2026-10-16", close: 2420, change: -20 },
  ]);
  expect(sent).toEqual([`${TWSE}exchangeReport/STOCK_DAY_ALL`]);
});

test("reads what both exchanges keep on record of how each company is run, newest first", async () => {
  const { sent, exchanges } = fakeExchanges({
    [`${TWSE}opendata/t187ap09_L`]: [
      {
        出表日期: "1150819",
        百分比: "90 以上",
        公司名稱: "3040      範例遠見  99.36\r\n2530      範例建設  92.69\r\n",
      },
    ],
    [`${TPEX}mopsfin_t187ap09_O`]: [
      {
        Date: "1150819",
        Percent: "20 以下",
        CompanyName: "5483      範例矽晶  0.00\r\n",
      },
    ],
    [`${TWSE}opendata/t187ap22_L`]: [
      {
        出表日期: "1151017",
        發函日期: "1151012",
        股票代號: "1589",
        公司名稱: "範例能源",
        違規事由: "未依規定期限\r\n公告申報財務報告",
        違反法規: "證券交易法第165條之3",
        裁處情形: "處新臺幣72萬元罰鍰。",
      },
    ],
    [`${TPEX}mopsfin_t187ap23_O`]: [
      {
        Date: "1151018",
        發函日期: "1150116",
        SecuritiesCompanyCode: "3664",
        CompanyName: "範例-KY",
        違規事由: "內部控制制度之執行核有缺失",
      },
    ],
    [`${TWSE}opendata/t187ap24_L`]: [
      {
        出表日期: "1151017",
        公司代號: "1516",
        公司名稱: "範例飛",
        經營權異動日期: "1150629",
        經營權異動說明: "董事席次累積變動過半",
      },
    ],
  });

  expect(await exchanges.getGovernance(Market.TW)).toEqual([
    {
      symbol: "1589",
      kind: GovernanceKind.Sanction,
      date: "2026-10-12",
      note: "未依規定期限公告申報財務報告",
      pledged: null,
    },
    {
      symbol: "3040",
      kind: GovernanceKind.DirectorPledge,
      date: "2026-08-19",
      note: null,
      pledged: 99.36,
    },
    {
      symbol: "2530",
      kind: GovernanceKind.DirectorPledge,
      date: "2026-08-19",
      note: null,
      pledged: 92.69,
    },
    {
      symbol: "5483",
      kind: GovernanceKind.DirectorPledge,
      date: "2026-08-19",
      note: null,
      pledged: 0,
    },
    {
      symbol: "1516",
      kind: GovernanceKind.ControlChange,
      date: "2026-06-29",
      note: "董事席次累積變動過半",
      pledged: null,
    },
    {
      symbol: "3664",
      kind: GovernanceKind.ExchangeFine,
      date: "2026-01-16",
      note: "內部控制制度之執行核有缺失",
      pledged: null,
    },
  ]);
  expect(sent.toSorted()).toEqual([
    `${TWSE}opendata/t187ap09_L`,
    `${TWSE}opendata/t187ap22_L`,
    `${TWSE}opendata/t187ap23_L`,
    `${TWSE}opendata/t187ap24_L`,
    `${TPEX}mopsfin_t187ap09_O`,
    `${TPEX}mopsfin_t187ap22_O`,
    `${TPEX}mopsfin_t187ap23_O`,
    `${TPEX}mopsfin_t187ap24_O`,
  ]);
});

test("outside Taiwan there is nothing to read, and it costs no request", async () => {
  const { sent, exchanges } = fakeExchanges();

  expect(await exchanges.getRestrictions(Market.US)).toEqual([]);
  expect(await exchanges.getFunds(Market.US)).toEqual([]);
  expect(await exchanges.getMultiples(Market.US)).toEqual([]);
  expect(await exchanges.getExNotices(Market.US)).toEqual([]);
  expect(await exchanges.getMeetings(Market.US)).toEqual([]);
  expect(await exchanges.getClosures(Market.US)).toEqual([]);
  expect(await exchanges.getCompanies(Market.US)).toEqual([]);
  expect(await exchanges.getSectorCloses(Market.US)).toEqual([]);
  expect(await exchanges.getGovernance(Market.US)).toEqual([]);
  expect(await exchanges.getPriceLimits(Market.US)).toEqual([]);
  expect(sent).toEqual([]);
});
