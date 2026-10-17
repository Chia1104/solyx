import ky, { isHTTPError } from "ky";
import type { KyInstance } from "ky";
import * as z from "zod";

import type {
  FundCosts,
  FundReportsProvider,
  Listed,
  NetAssetValue,
} from "@solyx/core/fundamentals";
import { Market, currencyOf } from "@solyx/core/market";

// Where SITCA keeps the files it publishes as government open data.
const SITCA_FILES_URL = "https://www.sitca.org.tw/MemberK0000/F/03/";

// Every domestic fund's newest net asset value, one row per share class.
const NAV_FILE = "nav.csv";

// What every domestic fund paid out of its assets over the newest month.
const COSTS_FILE = "46443投信投顧公會境內基金各項費用資料.csv";

// Units of a listed fund carry its exchange code; an unlisted fund's start with a letter, as `T0138A`.
const LISTING_CODE = /^\d/;

const textSchema = z.string().trim();

// A day written `20261016`.
const daySchema = textSchema
  .regex(/^\d{8}$/)
  .transform((day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`)
  .pipe(z.iso.date());

// A month written `202609`.
const monthSchema = textSchema
  .regex(/^\d{4}(0[1-9]|1[0-2])$/)
  .transform((month) => `${month.slice(0, 4)}-${month.slice(4)}`);

const numberSchema = textSchema.regex(/^-?\d+(\.\d+)?$/).transform(Number);

// A fund's tax id, which a share class writes with a letter after it, as `42482726A`.
const fundIdSchema = textSchema
  .regex(/^\d+[A-Z]*$/)
  .transform((id) => id.replace(/[A-Z]+$/, ""));

const navSchema = z.object({
  日期: daySchema,
  基金統編: fundIdSchema,
  基金淨值: numberSchema.pipe(z.number().positive()),
  幣別: textSchema,
  受益憑證代號: textSchema,
});

type NavRow = z.infer<typeof navSchema>;

const costsSchema = z
  .object({
    年月: monthSchema,
    基金統編: fundIdSchema,
    月經理費_比率: numberSchema,
    月保管費_比率: numberSchema,
    月保證費_比率: numberSchema,
    月手續費_比率: numberSchema,
    月交易稅_比率: numberSchema,
    月其他費用_比率: numberSchema,
    合計_比率: numberSchema,
  })
  .transform((row) => ({
    fund: row.基金統編,
    costs: {
      month: row.年月,
      management: row.月經理費_比率,
      custody: row.月保管費_比率,
      guarantee: row.月保證費_比率,
      commission: row.月手續費_比率,
      tax: row.月交易稅_比率,
      other: row.月其他費用_比率,
      total: row.合計_比率,
    } satisfies FundCosts,
  }));

/**
 * A file's rows by the names its first line gives, each dropped unless it parses, as is one with
 * more or fewer fields than those names. A file none of whose rows parse fails, since that is
 * SITCA writing it another way, not a market with no funds.
 */
async function rows<Row>(
  api: KyInstance,
  file: string,
  schema: z.ZodType<Row>
): Promise<Row[]> {
  // Not ky's `.text()`, whose `Accept: text/*` SITCA refuses, since it serves the files as octet streams.
  const response = await api.get(file);

  // Reading it as text drops the byte order mark SITCA starts each file with.
  const [header = "", ...lines] = (await response.text())
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  const names = header.split(",").map((name) => name.trim());

  const read = lines.flatMap((line) => {
    const fields = line.split(",");

    if (fields.length !== names.length) return [];

    const parsed = schema.safeParse(
      Object.fromEntries(names.map((name, index) => [name, fields[index]]))
    );

    return parsed.success ? [parsed.data] : [];
  });

  if (lines.length > 0 && read.length === 0) {
    throw new Error(
      `SITCA: none of the ${lines.length} rows of ${file} read as expected`
    );
  }

  return read;
}

const listed = (navs: readonly NavRow[]) =>
  navs.filter((nav) => LISTING_CODE.test(nav.受益憑證代號));

export interface SitcaOptions {
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * What Taiwan's listed funds report to the Securities Investment Trust & Consulting Association
 * (SITCA), from the files it publishes as government open data, which need no key: each fund's
 * newest net asset value and what it paid out of its assets over the newest month. Each file
 * holds every domestic fund, listed on either exchange or not, so one request answers for a
 * whole market. A fund listed abroad and offered here, or a futures fund, reports elsewhere and
 * has neither.
 */
export function createSitca(options: SitcaOptions = {}): FundReportsProvider {
  const api = ky.create({
    baseUrl: SITCA_FILES_URL,
    fetch: options.fetch,
    hooks: {
      beforeError: [
        ({ error }) => {
          error.message = isHTTPError(error)
            ? `SITCA answered ${error.response.status}`
            : `SITCA: ${error.message}`;

          return error;
        },
      ],
    },
  });

  return {
    id: "sitca",
    markets: [Market.TW],

    async getNetAssetValues(market) {
      if (market !== Market.TW) return [];

      const navs = await rows(api, NAV_FILE, navSchema);

      // A value struck in another currency, as a class priced in dollars, is no unit's price here.
      return listed(navs).flatMap((nav): Listed<NetAssetValue>[] =>
        nav.幣別 === currencyOf(market)
          ? [{ symbol: nav.受益憑證代號, date: nav.日期, value: nav.基金淨值 }]
          : []
      );
    },

    async getCosts(market) {
      if (market !== Market.TW) return [];

      const [navs, costs] = await Promise.all([
        rows(api, NAV_FILE, navSchema),
        rows(api, COSTS_FILE, costsSchema),
      ]);

      // The costs name a fund by its tax id alone, which only the values pair with its code.
      const byFund = new Map(costs.map((each) => [each.fund, each.costs]));

      return listed(navs).flatMap((nav): Listed<FundCosts>[] => {
        const paid = byFund.get(nav.基金統編);

        return paid ? [{ symbol: nav.受益憑證代號, ...paid }] : [];
      });
    },
  };
}
