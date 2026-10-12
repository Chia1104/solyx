import { mapKeys, sortBy } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import type { KyInstance } from "ky";
import * as z from "zod";

import { RestrictionKind } from "@solyx/core/fundamentals";
import type {
  ExNotice,
  ExchangeListsProvider,
  ExchangeMultiples,
  FundProfile,
  Listed,
  ShareholdersMeeting,
  TradingRestriction,
} from "@solyx/core/fundamentals";
import { Market, shiftDate } from "@solyx/core/market";

const TWSE_API_URL = "https://openapi.twse.com.tw/v1/";

const TPEX_API_URL = "https://www.tpex.org.tw/openapi/v1/";

// The exchanges pad some values with spaces.
const textSchema = z.string().trim();

const unsetSchema = textSchema.max(0).transform(() => null);

// A day in the Republic of China calendar, written `1151012` or `115/10/12`.
const rocDaySchema = textSchema
  .regex(/^\d{2,3}\/?\d{2}\/?\d{2}$/)
  .transform((day) => {
    const digits = day.replaceAll("/", "");

    return `${Number(digits.slice(0, -4)) + 1911}-${digits.slice(-4, -2)}-${digits.slice(-2)}`;
  })
  .pipe(z.iso.date());

// The exchanges leave a day that is not set empty.
const rocDayOrUnsetSchema = z.union([rocDaySchema, unsetSchema]);

// A disposition's first and last days, which TWSE writes `115/10/08～115/10/15` and TPEx `1151012~1151016`.
const rocPeriodSchema = textSchema
  .transform((period) => period.split(/[~～]/))
  .pipe(z.tuple([rocDaySchema, rocDaySchema]));

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
      StartDate: rocDaySchema,
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
    TradingHaltDate: rocDaySchema,
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
    ShortSaleSuspensionStartDate: rocDaySchema,
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
    FirstDayToSuspendSellThenBuy: rocDaySchema,
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
    上市日期: rocDaySchema.nullable().catch(null),
    "發行單位數/轉換數": textSchema
      .regex(/^\d+$/)
      .transform(Number)
      .nullable()
      .catch(null),
    出表日期: rocDaySchema,
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

// A multiple, which an exchange fills with a word for nothing where it works none out.
const multipleSchema = z.union([
  textSchema.regex(/^\d+(\.\d+)?$/).transform(Number),
  textSchema.refine((text) => NOTHING.has(text)).transform(() => null),
]);

const twseMultiplesSchema = z
  .object({
    Code: codeSchema,
    Date: rocDaySchema,
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
    Date: rocDaySchema,
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
    Date: rocDaySchema,
    Exdividend: exKindSchema,
    CashDividend: noticeCashSchema,
  })
  .transform((row) =>
    exNotice(row.Code, row.Date, row.Exdividend, row.CashDividend)
  );

const tpexExNoticeSchema = z
  .object({
    SecuritiesCompanyCode: codeSchema,
    ExRrightsExDividendDate: rocDaySchema,
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
    開會日期: rocDaySchema,
    是否改選董監: textSchema.pipe(z.enum(["是", "否"])),
  })
  .transform((row): Listed<ShareholdersMeeting> => ({
    symbol: row[MEETING_CODE],
    date: row.開會日期,
    regular: row["股東常(臨時)會"] === "常會",
    election: row.是否改選董監 === "是",
  }));

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

  const read = rows.flatMap((row) => {
    const parsed = schema.safeParse(row);

    return parsed.success ? [parsed.data] : [];
  });

  if (rows.length > 0 && read.length === 0) {
    throw new Error(
      `${name}: none of the ${rows.length} rows of ${path} read as expected`
    );
  }

  return read;
}

export interface TwExchangesOptions {
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * The restrictions Taiwan's exchanges put on their listings, the funds they list, the multiples
 * they work out, their notices of shares going ex and their companies' shareholders' meetings,
 * from the open data of the Taiwan Stock Exchange and the Taipei Exchange, which need no key. Each
 * list is the exchange's own of today, so one request answers for every listing and a restriction
 * that ended may be gone from it. The Taipei Exchange publishes no list of its funds, so those
 * have no profile.
 */
export function createTwExchanges(
  options: TwExchangesOptions = {}
): ExchangeListsProvider {
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
      ]);

      return sortBy(lists.flat(), [({ from }) => from]);
    },

    async getFunds(market) {
      if (market !== Market.TW) return [];

      return list(twse, "opendata/t187ap47_L", twseFundSchema, "基金代號");
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
  };
}
