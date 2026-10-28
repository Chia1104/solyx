import { mapKeys, orderBy, sortBy } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import type { KyInstance } from "ky";
import * as z from "zod";

import { GovernanceKind, RestrictionKind } from "@solyx/core/fundamentals";
import type {
  ExNotice,
  ExchangeListsProvider,
  ExchangeMultiples,
  FundProfile,
  Company,
  GovernanceRecord,
  Listed,
  ListingName,
  ShareholdersMeeting,
  TradingRestriction,
} from "@solyx/core/fundamentals";
import { Market, exchangeDate } from "@solyx/core/market";
import type { PriceLimits } from "@solyx/core/risk";
import { twRocDaySchema } from "@solyx/core/rules/tw";
import type { SessionClose } from "@solyx/core/sectors";
import { weekdays } from "@solyx/core/session";
import type { ClosuresProvider } from "@solyx/core/session";
import { shiftDate } from "@solyx/utils/date";

import { readRows } from "./rows.ts";

const TWSE_API_URL = "https://openapi.twse.com.tw/v1/";

const TPEX_API_URL = "https://www.tpex.org.tw/openapi/v1/";

// The exchanges pad some values with spaces.
const textSchema = z.string().trim();

const unsetSchema = textSchema.max(0).transform(() => null);

// The exchanges leave a day that is not set empty.
const rocDayOrUnsetSchema = z.union([twRocDaySchema, unsetSchema]);

// A disposition's first and last days, which TWSE writes `115/10/08～115/10/15` and TPEx `1151012~1151016`.
const rocPeriodSchema = textSchema
  .transform((period) => period.split(/[~～]/))
  .pipe(z.tuple([twRocDaySchema, twRocDaySchema]));

const codeSchema = textSchema.min(1);

/** Through the day before `back`, the day it is lifted, which may be the day it began; `null` while none is set. */
function throughDayBefore(from: string, back: string | null): string | null {
  if (back === null) return null;

  const dayBefore = shiftDate(back, -1);

  return dayBefore > from ? dayBefore : from;
}

// TWSE's suspensions of selling short and of day trading that sells first, from the first day to the last.
const twseSuspensionSchema = (kind: RestrictionKind) =>
  z
    .object({
      Code: codeSchema,
      StartDate: twRocDaySchema,
      EndDate: rocDayOrUnsetSchema,
      Reason: textSchema,
    })
    .transform((row): Listed<TradingRestriction> => ({
      symbol: row.Code,
      kind,
      from: row.StartDate,
      until: row.EndDate,
      note: row.Reason || null,
    }));

const twseDispositionSchema = z
  .object({
    Code: codeSchema,
    DispositionPeriod: rocPeriodSchema,
    DispositionMeasures: textSchema,
    ReasonsOfDisposition: textSchema,
  })
  .transform((row): Listed<TradingRestriction> => ({
    symbol: row.Code,
    kind: RestrictionKind.Disposition,
    from: row.DispositionPeriod[0],
    until: row.DispositionPeriod[1],
    note:
      [row.DispositionMeasures, row.ReasonsOfDisposition]
        .filter((part) => part !== "")
        .join("：") || null,
  }));

const twseHaltSchema = z
  .object({
    Code: codeSchema,
    TradingHaltDate: twRocDaySchema,
    TradingResumptionDate: rocDayOrUnsetSchema,
  })
  .transform((row): Listed<TradingRestriction> => ({
    symbol: row.Code,
    kind: RestrictionKind.Halt,
    from: row.TradingHaltDate,
    until: throughDayBefore(row.TradingHaltDate, row.TradingResumptionDate),
    note: null,
  }));

const tpexShortSaleSchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    ShortSaleSuspensionStartDate: twRocDaySchema,
    ShortSaleSuspensionEndDate: rocDayOrUnsetSchema,
    Reason: textSchema,
  })
  .transform((row): Listed<TradingRestriction> => ({
    symbol: row.SecuritiesCompanyCode,
    kind: RestrictionKind.ShortSaleSuspension,
    from: row.ShortSaleSuspensionStartDate,
    until: row.ShortSaleSuspensionEndDate,
    note: row.Reason || null,
  }));

// TPEx names the day sell-first day trading is allowed again, where TWSE names the last day it is not.
const tpexDayTradingSchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    FirstDayToSuspendSellThenBuy: twRocDaySchema,
    DayOfReinstatingSellThenBuy: rocDayOrUnsetSchema,
    Reason: textSchema,
  })
  .transform((row): Listed<TradingRestriction> => ({
    symbol: row.SecuritiesCompanyCode,
    kind: RestrictionKind.DayTradingSuspension,
    from: row.FirstDayToSuspendSellThenBuy,
    until: throughDayBefore(
      row.FirstDayToSuspendSellThenBuy,
      row.DayOfReinstatingSellThenBuy
    ),
    note: row.Reason || null,
  }));

const tpexDispositionSchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    DispositionPeriod: rocPeriodSchema,
    DispositionReasons: textSchema,
  })
  .transform((row): Listed<TradingRestriction> => ({
    symbol: row.SecuritiesCompanyCode,
    kind: RestrictionKind.Disposition,
    from: row.DispositionPeriod[0],
    until: row.DispositionPeriod[1],
    note: row.DispositionReasons || null,
  }));

// A notice of attention, kept while the exchange's list holds it.
const attention = (
  symbol: string,
  from: string,
  note: string
): Listed<TradingRestriction> => ({
  symbol,
  kind: RestrictionKind.Attention,
  from,
  until: null,
  note: note || null,
});

const twseAttentionSchema = z
  .object({
    Code: codeSchema,
    Date: twRocDaySchema,
    TradingInfoForAttention: textSchema,
  })
  .transform((row) =>
    attention(row.Code, row.Date, row.TradingInfoForAttention)
  );

const tpexAttentionSchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    Date: twRocDaySchema,
    TradingInformation: textSchema,
  })
  .transform((row) =>
    attention(row.SecuritiesCompanyCode, row.Date, row.TradingInformation)
  );

// How often a listing met the attention criteria, as `115年10月13日至115年10月16日連續四次`, which ends on its last day.
const RUN_END = /至(\d{2,3})年(\d{1,2})月(\d{1,2})日/;

const runSchema = textSchema.regex(RUN_END).transform((run) => {
  const [, year = "", month = "", day = ""] = RUN_END.exec(run) ?? [];

  return {
    run,
    day: twRocDaySchema.parse(
      `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`
    ),
  };
});

const nearDisposition = (
  symbol: string,
  { run, day }: z.infer<typeof runSchema>
): Listed<TradingRestriction> => ({
  symbol,
  kind: RestrictionKind.NearDisposition,
  from: day,
  until: null,
  note: run,
});

const twseNearDispositionSchema = z
  .object({
    Code: codeSchema,
    RecentlyMetAttentionSecuritiesCriteria: runSchema,
  })
  .transform((row) =>
    nearDisposition(row.Code, row.RecentlyMetAttentionSecuritiesCriteria)
  );

const tpexNearDispositionSchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    AccumulationSituation: runSchema,
  })
  .transform((row) =>
    nearDisposition(row.SecuritiesCompanyCode, row.AccumulationSituation)
  );

// TPEx marks a term a listing trades under with a full-width `Ｙ`.
const MARKED = "Ｙ";

const markSchema = textSchema.transform((mark) => mark === MARKED);

// What TPEx lists of a listing's terms; only altered trading, batched matching and managed stock alter how it trades.
const tpexTermsSchema = z.object({
  SecuritiesCompanyCode: codeSchema,
  Date: twRocDaySchema,
  AlteredTrading: markSchema,
  PeriodicTrading: markSchema,
  ManagedStock: markSchema,
});

// The words the exchanges' own pages give the terms that come on top of altered trading.
const PERIODIC = "分盤交易";

const MANAGED = "管理股票";

/** Altered trading in force today, with the terms that come on top of it; `null` where none alters it. */
function alteredTrading(
  symbol: string,
  from: string,
  terms: { altered: boolean; periodic: boolean; managed: boolean }
): Listed<TradingRestriction> | null {
  if (!terms.altered && !terms.periodic && !terms.managed) return null;

  const note = [
    terms.periodic ? PERIODIC : null,
    terms.managed ? MANAGED : null,
  ].filter((part) => part !== null);

  return {
    symbol,
    kind: RestrictionKind.AlteredTrading,
    from,
    until: null,
    note: note.length > 0 ? note.join("、") : null,
  };
}

// TWSE's list of what trades under altered terms names no day, so it is today's; `**` marks batched matching.
const twseAlteredSchema = z.object({
  Code: codeSchema,
  PeriodicCallAuctionTrading: textSchema,
});

// One line of TPEx's halts of the year: a halt, or the resumption of the halt listed before it for the same code.
const tpexHaltRowSchema = z.object({
  SecuritiesCompanyCode: codeSchema,
  DateOfSuspendedTrading: rocDayOrUnsetSchema,
  DateOfResumedTrading: rocDayOrUnsetSchema,
});

/** Each halt with the resumption listed after it for its code, in the order TPEx lists them. */
function tpexHalts(
  rows: readonly z.infer<typeof tpexHaltRowSchema>[]
): Listed<TradingRestriction>[] {
  const halts: Listed<TradingRestriction>[] = [];
  const unresumed = new Map<string, Listed<TradingRestriction>>();

  for (const row of rows) {
    const code = row.SecuritiesCompanyCode;

    if (row.DateOfSuspendedTrading !== null) {
      const halt: Listed<TradingRestriction> = {
        symbol: code,
        kind: RestrictionKind.Halt,
        from: row.DateOfSuspendedTrading,
        until: null,
        note: null,
      };

      halts.push(halt);
      unresumed.set(code, halt);
    }

    const halt = unresumed.get(code);

    if (halt && row.DateOfResumedTrading !== null) {
      halt.until = throughDayBefore(halt.from, row.DateOfResumedTrading);
      unresumed.delete(code);
    }
  }

  return halts;
}

// What the exchange fills a field with when it has nothing to say.
const NOTHING = new Set(["", "不適用", "無", "NA", "N/A"]);

const textOrNothingSchema = textSchema
  .transform((text) => (NOTHING.has(text) ? null : text))
  .catch(null);

// One fund of TWSE's list. Only its code, name and kind must read; the rest is left empty where it does not.
const twseFundSchema = z
  .object({
    基金代號: codeSchema,
    基金中文名稱: textSchema.min(1),
    基金類型: textSchema.min(1),
    "標的指數/追蹤指數名稱": textOrNothingSchema,
    績效指標中文名稱: textOrNothingSchema,
    是否包含國外成分股: textSchema
      .pipe(z.enum(["是", "否"]))
      .transform((answer) => answer === "是")
      .nullable()
      .catch(null),
    基金經理人: textOrNothingSchema,
    上市日期: twRocDaySchema.nullable().catch(null),
    "發行單位數/轉換數": textSchema
      .regex(/^\d+$/)
      .transform(Number)
      .nullable()
      .catch(null),
    出表日期: twRocDaySchema,
  })
  .transform((row): Listed<FundProfile> => ({
    symbol: row.基金代號,
    name: row.基金中文名稱,
    category: row.基金類型,
    index: row["標的指數/追蹤指數名稱"],
    benchmark: row.績效指標中文名稱,
    foreignHoldings: row.是否包含國外成分股,
    manager: row.基金經理人,
    listedOn: row.上市日期,
    units: row["發行單位數/轉換數"],
    asOf: row.出表日期,
  }));

// A listing on TWSE's list of the last session's trading, which holds those that did not trade too.
const twseListingSchema = z
  .object({ Code: codeSchema })
  .transform((row) => row.Code);

// A multiple, which an exchange fills with a word for nothing where it works none out.
const multipleSchema = z.union([
  textSchema.regex(/^\d+(\.\d+)?$/).transform(Number),
  textSchema.refine((text) => NOTHING.has(text)).transform(() => null),
]);

const twseMultiplesSchema = z
  .object({
    Code: codeSchema,
    Date: twRocDaySchema,
    PEratio: multipleSchema,
    DividendYield: multipleSchema,
    PBratio: multipleSchema,
  })
  .transform((row): Listed<ExchangeMultiples> => ({
    symbol: row.Code,
    asOf: row.Date,
    priceToEarnings: row.PEratio,
    dividendYield: row.DividendYield,
    priceToBook: row.PBratio,
  }));

const tpexMultiplesSchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    Date: twRocDaySchema,
    PriceEarningRatio: multipleSchema,
    YieldRatio: multipleSchema,
    PriceBookRatio: multipleSchema,
  })
  .transform((row): Listed<ExchangeMultiples> => ({
    symbol: row.SecuritiesCompanyCode,
    asOf: row.Date,
    priceToEarnings: row.PriceEarningRatio,
    dividendYield: row.YieldRatio,
    priceToBook: row.PriceBookRatio,
  }));

// What a notice says the shares go ex, which TWSE writes `息`, `權` or `權息` and TPEx `除息`, `除權` or `除權息`.
const exKindSchema = textSchema.regex(/^除?(權|息|權息)$/);

// What an exchange fills a notice's cash with until the amount is announced.
const UNANNOUNCED = new Set(["", "尚未公告"]);

const noticeCashSchema = z.union([
  textSchema.regex(/^\d+(\.\d+)?$/).transform(Number),
  textSchema.refine((text) => UNANNOUNCED.has(text)).transform(() => null),
]);

/** A notice of the day `code`'s shares go ex what `kind` names, with the cash a share only where they go ex cash and its amount is set. */
function exNotice(
  code: string,
  date: string,
  kind: string,
  cash: number | null
): Listed<ExNotice> {
  const exDividend = kind.includes("息");

  return {
    symbol: code,
    date,
    exDividend,
    exRights: kind.includes("權"),
    cash: exDividend && cash !== null && cash > 0 ? cash : null,
  };
}

const twseExNoticeSchema = z
  .object({
    Code: codeSchema,
    Date: twRocDaySchema,
    Exdividend: exKindSchema,
    CashDividend: noticeCashSchema,
  })
  .transform((row) =>
    exNotice(row.Code, row.Date, row.Exdividend, row.CashDividend)
  );

const tpexExNoticeSchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    ExRrightsExDividendDate: twRocDaySchema,
    ExRrightsExDividend: exKindSchema,
    CashDividend: noticeCashSchema,
  })
  .transform((row) =>
    exNotice(
      row.SecuritiesCompanyCode,
      row.ExRrightsExDividendDate,
      row.ExRrightsExDividend,
      row.CashDividend
    )
  );

// Both exchanges list their companies' shareholders' meetings under the same names.
const MEETING_CODE = "公司代號";

const meetingSchema = z
  .object({
    [MEETING_CODE]: codeSchema,
    "股東常(臨時)會": textSchema.pipe(z.enum(["常會", "臨時會"])),
    開會日期: twRocDaySchema,
    是否改選董監: textSchema.pipe(z.enum(["是", "否"])),
  })
  .transform((row): Listed<ShareholdersMeeting> => ({
    symbol: row[MEETING_CODE],
    date: row.開會日期,
    regular: row["股東常(臨時)會"] === "常會",
    election: row.是否改選董監 === "是",
  }));

/**
 * What the exchanges call each industry code, as their own lists pair the two. Both exchanges
 * class by the same codes; one they add later reads by its code alone.
 */
const INDUSTRIES = new Map([
  ["01", "水泥工業"],
  ["02", "食品工業"],
  ["03", "塑膠工業"],
  ["04", "紡織纖維"],
  ["05", "電機機械"],
  ["06", "電器電纜"],
  ["08", "玻璃陶瓷"],
  ["09", "造紙工業"],
  ["10", "鋼鐵工業"],
  ["11", "橡膠工業"],
  ["12", "汽車工業"],
  ["14", "建材營造"],
  ["15", "航運業"],
  ["16", "觀光餐旅"],
  ["17", "金融保險業"],
  ["18", "貿易百貨"],
  ["20", "其他"],
  ["21", "化學工業"],
  ["22", "生技醫療業"],
  ["23", "油電燃氣業"],
  ["24", "半導體業"],
  ["25", "電腦及週邊設備業"],
  ["26", "光電業"],
  ["27", "通信網路業"],
  ["28", "電子零組件業"],
  ["29", "電子通路業"],
  ["30", "資訊服務業"],
  ["31", "其他電子業"],
  ["32", "文化創意業"],
  ["33", "農業科技"],
  ["35", "綠能環保"],
  ["36", "數位雲端"],
  ["37", "運動休閒"],
  ["38", "居家生活"],
  ["91", "存託憑證"],
]);

// The exchanges class depositary receipts under this code, and list for them the shares of their
// foreign issuer, which are not the receipts the listing trades as.
const DEPOSITARY_RECEIPTS = "91";

const company = (
  symbol: string,
  code: string,
  shares: number | null
): Listed<Company> => ({
  symbol,
  industry: { code, name: INDUSTRIES.get(code) ?? code },
  shares: code === DEPOSITARY_RECEIPTS ? null : shares,
});

// A count of shares; one written any other way reads as none, which leaves the company's industry standing.
const sharesSchema = textSchema
  .regex(/^\d+$/)
  .transform(Number)
  .nullable()
  .catch(null);

const TWSE_COMPANY_CODE = "公司代號";

const twseCompanySchema = z
  .object({
    [TWSE_COMPANY_CODE]: codeSchema,
    產業別: codeSchema,
    已發行普通股數或TDR原股發行股數: sharesSchema,
  })
  .transform((row) =>
    company(
      row[TWSE_COMPANY_CODE],
      row.產業別,
      row.已發行普通股數或TDR原股發行股數
    )
  );

const tpexCompanySchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    SecuritiesIndustryCode: codeSchema,
    IssueShares: sharesSchema,
  })
  .transform((row) =>
    company(
      row.SecuritiesCompanyCode,
      row.SecuritiesIndustryCode,
      row.IssueShares
    )
  );

// The exchanges number warrants, tens of thousands of which their lists of price limits hold, in
// six characters from `03` to `08` on TWSE and from `7` on TPEx, and nothing else so.
const WARRANT_CODE = /^(?:0[3-8]\d{3}|7\d{4})[\dA-Z]$/;

const listingCodeSchema = codeSchema.refine((code) => !WARRANT_CODE.test(code));

const priceSchema = textSchema.regex(/^\d+(\.\d+)?$/).transform(Number);

// The limit-up the exchanges set for a listing that trades without limits, as a fund of foreign shares does.
const UNLIMITED = 9999.95;

const priceLimits = (
  symbol: string,
  after: string,
  low: number,
  high: number
): Listed<PriceLimits> => ({
  symbol,
  after,
  band: high >= UNLIMITED ? null : { low, high },
});

// One of TWSE's limits for the next session, which name the last day the listing traded rather than the session they follow.
const twseLimitSchema = z.object({
  Code: listingCodeSchema,
  TodayLimitUp: priceSchema,
  TodayLimitDown: priceSchema,
  LastTradingDay: twRocDaySchema,
});

// TPEx's quotes of a session, each with the limits it set for the next.
const tpexLimitSchema = z
  .object({
    SecuritiesCompanyCode: listingCodeSchema,
    Date: twRocDaySchema,
    NextLimitUp: priceSchema,
    NextLimitDown: priceSchema,
  })
  .transform((row) =>
    priceLimits(
      row.SecuritiesCompanyCode,
      row.Date,
      row.NextLimitDown,
      row.NextLimitUp
    )
  );

// A listing's name in an exchange's quotes of its last session.
const twseNameSchema = z
  .object({ Code: listingCodeSchema, Name: textSchema.min(1) })
  .transform((row): Listed<ListingName> => ({
    symbol: row.Code,
    name: row.Name,
  }));

const tpexNameSchema = z
  .object({
    SecuritiesCompanyCode: listingCodeSchema,
    CompanyName: textSchema.min(1),
  })
  .transform((row): Listed<ListingName> => ({
    symbol: row.SecuritiesCompanyCode,
    name: row.CompanyName,
  }));

// A listing's close of TWSE's last session; one that did not trade has no close and is left out.
const twseCloseSchema = z
  .object({
    Code: codeSchema,
    Date: twRocDaySchema,
    ClosingPrice: priceSchema,
    Change: textSchema.regex(/^[-+]?\d+(\.\d+)?$/).transform(Number),
  })
  .transform((row): Listed<SessionClose> => ({
    symbol: row.Code,
    date: row.Date,
    close: row.ClosingPrice,
    change: row.Change,
  }));

// A line of a band of the exchanges' list of pledges, `3040      遠見  99.36`: a code, a name and the part pledged.
const PLEDGE_LINE = /^\s*(\S+)\s+.*?\s(\d+(?:\.\d+)?)\s*$/;

/** The companies a band of pledges lists, each with the part its directors pledged. */
function pledges(date: string, companies: string): Listed<GovernanceRecord>[] {
  return companies.split(/\r?\n/).flatMap((line) => {
    const [, symbol, pledged] = PLEDGE_LINE.exec(line) ?? [];

    return symbol === undefined || pledged === undefined
      ? []
      : [
          {
            symbol,
            kind: GovernanceKind.DirectorPledge,
            date,
            note: null,
            pledged: Number(pledged),
          },
        ];
  });
}

const twsePledgesSchema = z
  .object({ 出表日期: twRocDaySchema, 公司名稱: z.string() })
  .transform((row) => pledges(row.出表日期, row.公司名稱));

const tpexPledgesSchema = z
  .object({ Date: twRocDaySchema, CompanyName: z.string() })
  .transform((row) => pledges(row.Date, row.CompanyName));

const governance = (
  symbol: string,
  kind: GovernanceKind,
  date: string,
  note: string
): Listed<GovernanceRecord> => ({ symbol, kind, date, note, pledged: null });

// The regulator's sanctions and the exchange's fines, which both exchanges list under the same names, but for the code.
const fineSchema = (code: string, kind: GovernanceKind) =>
  z
    .object({
      [code]: codeSchema,
      發函日期: twRocDaySchema,
      違規事由: textSchema.min(1),
    })
    .transform((row) =>
      governance(
        row[code],
        kind,
        row.發函日期,
        row.違規事由.replace(/\s*\r?\n\s*/g, "")
      )
    );

const controlChangeSchema = (code: string) =>
  z
    .object({
      [code]: codeSchema,
      經營權異動日期: twRocDaySchema,
      經營權異動說明: textSchema.min(1),
    })
    .transform((row) =>
      governance(
        row[code],
        GovernanceKind.ControlChange,
        row.經營權異動日期,
        row.經營權異動說明.replace(/\s*\r?\n\s*/g, "")
      )
    );

// TWSE's days of the year, each with what it calls the day.
const twseDaySchema = z.object({
  Name: textSchema.min(1),
  Date: twRocDaySchema,
});

// The list also names the first and last trading days around a long holiday, which are no closures.
const TRADING_DAY = /交易日$/;

const listSchema = z.array(z.record(z.string(), z.unknown()));

interface Exchange {
  name: string;
  api: KyInstance;
  /** The key most of its lists name a listing's code under. */
  code: string;
}

/**
 * A list's rows, each dropped unless it parses. A list none of whose rows parse fails, since that
 * is the exchange writing the list another way, not a market with nothing listed.
 */
async function list<Row>(
  { name, api, code: usualCode }: Exchange,
  path: string,
  schema: z.ZodType<Row>,
  code = usualCode
): Promise<Row[]> {
  const response = await api.get(path);
  // A body that is not JSON, as a page saying the site is closed, fails as no list below.
  const body: unknown = await response.json().catch(() => undefined);
  const answered = listSchema.safeParse(body);

  if (!answered.success) {
    throw new Error(`${name}: ${path} did not answer a list of rows`);
  }

  // The exchanges pad some keys with spaces, and a list with nothing on it may answer one row with no code.
  const rows = answered.data
    .map((row) => mapKeys(row, (_, key) => key.trim()))
    .filter((row) => !unsetSchema.safeParse(row[code]).success);

  return readRows(rows, schema, name, path);
}

export interface TwExchangesOptions {
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
  /** Dates the lists that name no day of their own. @default () => new Date() */
  now?: () => Date;
}

/**
 * The restrictions Taiwan's exchanges put on their listings, the funds they list, the multiples
 * they work out, their notices of shares going ex, their companies' shareholders' meetings, the
 * industry they class each company in and the price limits they set for the next session,
 * from the open data of the Taiwan Stock Exchange and the Taipei Exchange, which need no key. Each
 * list is the exchange's own of today, so one request answers for every listing and a restriction
 * that ended may be gone from it. The Taipei Exchange publishes no list of its funds, so those
 * have no profile. The market's closures are the Taiwan Stock Exchange's of the year, which the
 * Taipei Exchange keeps too.
 */
export function createTwExchanges(
  options: TwExchangesOptions = {}
): ExchangeListsProvider & ClosuresProvider {
  const { now = () => new Date() } = options;

  const exchange = (name: string, baseUrl: string, code: string): Exchange => ({
    name,
    code,
    api: ky.create({
      baseUrl,
      fetch: options.fetch,
      hooks: {
        beforeError: [
          ({ error }) => {
            error.message = isHTTPError(error)
              ? `${name} answered ${error.response.status}`
              : `${name}: ${error.message}`;

            return error;
          },
        ],
      },
    }),
  });

  const twse = exchange("TWSE", TWSE_API_URL, "Code");
  const tpex = exchange("TPEx", TPEX_API_URL, "SecuritiesCompanyCode");

  return {
    id: "tw-exchanges",
    markets: [Market.TW],

    async getRestrictions(market) {
      if (market !== Market.TW) return [];

      const lists = await Promise.all([
        list(
          twse,
          "exchangeReport/BFI84U",
          twseSuspensionSchema(RestrictionKind.ShortSaleSuspension)
        ),
        list(
          twse,
          "exchangeReport/TWTBAU1",
          twseSuspensionSchema(RestrictionKind.DayTradingSuspension)
        ),
        list(twse, "announcement/punish", twseDispositionSchema),
        list(twse, "exchangeReport/TWTAWU", twseHaltSchema),
        list(tpex, "tpex_margin_trading_term", tpexShortSaleSchema),
        list(tpex, "tpex_intraday_trading_pre", tpexDayTradingSchema),
        list(tpex, "tpex_disposal_information", tpexDispositionSchema),
        list(tpex, "tpex_spendi_history", tpexHaltRowSchema).then(tpexHalts),
        list(twse, "announcement/notice", twseAttentionSchema),
        list(tpex, "tpex_trading_warning_information", tpexAttentionSchema),
        list(twse, "announcement/notetrans", twseNearDispositionSchema),
        list(tpex, "tpex_trading_warning_note", tpexNearDispositionSchema),
        list(twse, "exchangeReport/TWT85U", twseAlteredSchema).then((rows) => {
          const today = exchangeDate(Market.TW, now());

          return rows.flatMap(
            (row) =>
              alteredTrading(row.Code, today, {
                altered: true,
                periodic: row.PeriodicCallAuctionTrading === "**",
                managed: false,
              }) ?? []
          );
        }),
        list(tpex, "tpex_cmode", tpexTermsSchema).then((rows) =>
          rows.flatMap(
            (row) =>
              alteredTrading(row.SecuritiesCompanyCode, row.Date, {
                altered: row.AlteredTrading,
                periodic: row.PeriodicTrading,
                managed: row.ManagedStock,
              }) ?? []
          )
        ),
      ]);

      return sortBy(lists.flat(), [({ from }) => from]);
    },

    async getFunds(market) {
      if (market !== Market.TW) return [];

      const [funds, listings] = await Promise.all([
        list(twse, "opendata/t187ap47_L", twseFundSchema, "基金代號"),
        list(twse, "exchangeReport/STOCK_DAY_ALL", twseListingSchema),
      ]);

      // Leaving out every fund would read as the exchange listing none.
      if (listings.length === 0) {
        throw new Error("TWSE: exchangeReport/STOCK_DAY_ALL listed nothing");
      }

      // TWSE's list of funds keeps those it has delisted.
      const listed = new Set(listings);

      return funds.filter(({ symbol }) => listed.has(symbol));
    },

    async getMultiples(market) {
      if (market !== Market.TW) return [];

      const lists = await Promise.all([
        list(twse, "exchangeReport/BWIBBU_ALL", twseMultiplesSchema),
        list(tpex, "tpex_mainboard_peratio_analysis", tpexMultiplesSchema),
      ]);

      return lists.flat();
    },

    async getExNotices(market) {
      if (market !== Market.TW) return [];

      const lists = await Promise.all([
        list(twse, "exchangeReport/TWT48U_ALL", twseExNoticeSchema),
        list(tpex, "tpex_exright_prepost", tpexExNoticeSchema),
      ]);

      return sortBy(lists.flat(), [({ date }) => date]);
    },

    async getMeetings(market) {
      if (market !== Market.TW) return [];

      const lists = await Promise.all([
        list(twse, "opendata/t187ap41_L", meetingSchema, MEETING_CODE),
        list(tpex, "t187ap41_O", meetingSchema, MEETING_CODE),
      ]);

      return sortBy(lists.flat(), [({ date }) => date]);
    },

    async getCompanies(market) {
      if (market !== Market.TW) return [];

      const lists = await Promise.all([
        list(twse, "opendata/t187ap03_L", twseCompanySchema, TWSE_COMPANY_CODE),
        list(tpex, "mopsfin_t187ap03_O", tpexCompanySchema),
      ]);

      return lists.flat();
    },

    async getPriceLimits(market) {
      if (market !== Market.TW) return [];

      const [twseLimits, tpexLimits] = await Promise.all([
        list(twse, "exchangeReport/TWT84U", twseLimitSchema),
        list(tpex, "tpex_mainboard_daily_close_quotes", tpexLimitSchema),
      ]);

      // TWSE's list names no session of its own, so it follows the last day any listing traded.
      const after = twseLimits.reduce(
        (last, { LastTradingDay }) =>
          LastTradingDay > last ? LastTradingDay : last,
        ""
      );

      return [
        ...twseLimits.map((row) =>
          priceLimits(row.Code, after, row.TodayLimitDown, row.TodayLimitUp)
        ),
        ...tpexLimits,
      ];
    },

    async getListingNames(market) {
      if (market !== Market.TW) return [];

      const lists = await Promise.all([
        list(twse, "exchangeReport/STOCK_DAY_ALL", twseNameSchema),
        list(tpex, "tpex_mainboard_daily_close_quotes", tpexNameSchema),
      ]);

      return lists.flat();
    },

    // The sector indices are TWSE's, so only its listings' closes are read.
    async getSectorCloses(market) {
      if (market !== Market.TW) return [];

      return list(twse, "exchangeReport/STOCK_DAY_ALL", twseCloseSchema);
    },

    async getGovernance(market) {
      if (market !== Market.TW) return [];

      const lists = await Promise.all([
        list(twse, "opendata/t187ap09_L", twsePledgesSchema, "出表日期").then(
          (bands) => bands.flat()
        ),
        list(tpex, "mopsfin_t187ap09_O", tpexPledgesSchema, "Date").then(
          (bands) => bands.flat()
        ),
        list(
          twse,
          "opendata/t187ap22_L",
          fineSchema("股票代號", GovernanceKind.Sanction),
          "股票代號"
        ),
        list(
          tpex,
          "mopsfin_t187ap22_O",
          fineSchema("SecuritiesCompanyCode", GovernanceKind.Sanction)
        ),
        list(
          twse,
          "opendata/t187ap23_L",
          fineSchema("股票代號", GovernanceKind.ExchangeFine),
          "股票代號"
        ),
        list(
          tpex,
          "mopsfin_t187ap23_O",
          fineSchema("SecuritiesCompanyCode", GovernanceKind.ExchangeFine)
        ),
        list(
          twse,
          "opendata/t187ap24_L",
          controlChangeSchema(TWSE_COMPANY_CODE),
          TWSE_COMPANY_CODE
        ),
        list(
          tpex,
          "mopsfin_t187ap24_O",
          controlChangeSchema("SecuritiesCompanyCode")
        ),
      ]);

      return orderBy(lists.flat(), [({ date }) => date], ["desc"]);
    },

    async getClosures(market) {
      if (market !== Market.TW) return [];

      const days = await list(
        twse,
        "holidaySchedule/holidaySchedule",
        twseDaySchema,
        "Date"
      );

      return sortBy(
        days
          .filter(({ Name, Date }) => !TRADING_DAY.test(Name) && weekdays(Date))
          .map(({ Name, Date }) => ({ market, date: Date, name: Name })),
        [({ date }) => date]
      );
    },
  };
}
