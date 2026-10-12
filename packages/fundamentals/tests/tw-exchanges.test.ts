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

test("outside Taiwan there is nothing to read, and it costs no request", async () => {
  const { sent, exchanges } = fakeExchanges();

  expect(await exchanges.getRestrictions(Market.US)).toEqual([]);
  expect(sent).toEqual([]);
});
