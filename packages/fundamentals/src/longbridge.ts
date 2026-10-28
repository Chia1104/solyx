import ky, { isHTTPError } from "ky";
import * as z from "zod";

import type {
  BalanceSheet,
  CashFlow,
  Dividend,
  FundamentalsProvider,
  QuarterStatement,
} from "@solyx/core/fundamentals";
import { Market, exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { longbridgeDataCenter } from "@solyx/market-data/longbridge-sign-in";
import { createRateLimiter } from "@solyx/utils/rate-limit";

import { readRows } from "./rows.ts";

const API_URL = "https://openapi.longbridge.com";

// Longbridge sets no limit for its fundamentals, but refuses more than one request each 0.2 seconds.
const REQUESTS_PER_SECOND = 5;

// A 429 means something else shares the sign-in's budget, so it is tried again a few times, as
// Longbridge's own SDK does, rather than failing a read or hanging it.
const RATE_LIMIT_RETRIES = 5;

const MAX_RETRY_AFTER_MS = 10_000;

// The latest a quarter's figures are due, a 10-Q's for the smallest filers, and a fiscal year's 10-K.
const QUARTER_DUE_DAYS = 45;

const YEAR_DUE_DAYS = 90;

// Its descriptions, a distribution's among them, in traditional Chinese, as the app names US listings.
const LANGUAGE = "zh-HK";

/** Which of a quarter's statements a request reads. */
const ReportKind = {
  Income: "IS",
  Balance: "BS",
  Cash: "CF",
} as const;

type ReportKind = (typeof ReportKind)[keyof typeof ReportKind];

// Each quarter alone, as Longbridge reports them.
const QUARTERS_REPORT = "qf";

const envelopeSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown(),
});

/** One line's figure for a period: its fiscal label, its last day as UTC seconds and the figure as decimal text, empty for none. */
const periodValueSchema = z.object({
  period: z.string(),
  fp_end: z.string(),
  value: z.string(),
});

const reportsSchema = z.object({
  list: z.record(
    z.string(),
    z.object({
      indicators: z.array(
        z.object({
          accounts: z.array(
            z.object({ field: z.string(), values: z.array(z.unknown()) })
          ),
        })
      ),
    })
  ),
});

const dividendRowSchema = z.object({
  id: z.string(),
  desc: z.string(),
  ex_date: z.string(),
  payment_date: z.string(),
});

const dividendsSchema = z.object({ list: z.array(z.unknown()) });

/** A company's action: a distribution's announcement, ex, record and payment days under its id, and each quarter's results as released. */
const actionRowSchema = z.object({
  id: z.string(),
  action: z.string(),
  date: z.string(),
});

type Action = z.infer<typeof actionRowSchema>;

const actionsSchema = z.object({ items: z.array(z.unknown()) });

/** The action that dates a quarter's results being released. */
const RESULTS_RELEASED = "FinancialReport";

/** The action whose days, announcement first, belong to one distribution. */
const DISTRIBUTION = "DividendExDate";

export interface LongbridgeFundamentalsOptions {
  /** The signed-in user's OAuth access token, which the caller refreshes; rejects while signed out. */
  accessToken: () => Promise<string>;
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
}

/** A figure as Longbridge writes it; `null` for the empty text it sends for none. */
function figure(text: string): number | null {
  if (text === "") return null;

  const value = Number(text);

  return Number.isFinite(value) ? value : null;
}

/** `YYYY-MM-DD` from the `YYYYMMDD` or `YYYY.MM.DD` Longbridge writes; `null` for a day it left empty or wrote otherwise. */
function day(text: string): string | null {
  const digits = text.replaceAll(/[.-]/g, "");

  return /^\d{8}$/.test(digits)
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
    : null;
}

/** A quarter's lines by field, with its fiscal label, such as `Q4 2025`. */
interface Quarter {
  periodEnd: string;
  label: string;
  lines: Map<string, number | null>;
}

/** A line's figure for one period, under the line's field. */
interface LineValue extends z.infer<typeof periodValueSchema> {
  field: string;
}

/** Every quarter the figures fall in, oldest first, each with its lines. */
function quartersOf(values: readonly LineValue[]): Quarter[] {
  const quarters = new Map<string, Quarter>();

  for (const { field, period, fp_end, value } of values) {
    const seconds = Number(fp_end);

    if (!Number.isInteger(seconds) || seconds <= 0) continue;

    const periodEnd = exchangeDate(Market.US, new Date(seconds * 1000));

    const quarter = quarters.get(periodEnd) ?? {
      periodEnd,
      label: period,
      lines: new Map(),
    };

    quarter.lines.set(field, figure(value));
    quarters.set(periodEnd, quarter);
  }

  return [...quarters.values()].toSorted((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd)
  );
}

const line = (quarter: Quarter, field: string) =>
  quarter.lines.get(field) ?? null;

/**
 * When a quarter's figures were public: the first release of results after it ends, as
 * Longbridge dates them, unless that comes after the filing deadline, which then stands, since
 * a later release is the next quarter's where one is missing.
 */
function publishedOn(quarter: Quarter, releases: readonly string[]): string {
  const days = /^Q4\b/.test(quarter.label) ? YEAR_DUE_DAYS : QUARTER_DUE_DAYS;

  const deadline = Temporal.PlainDate.from(quarter.periodEnd)
    .add({ days })
    .toString();

  const release = releases.find((date) => date > quarter.periodEnd);

  return release !== undefined && release <= deadline ? release : deadline;
}

/** What a distribution pays a share in US dollars, from Longbridge's description of it; `null` where it names none. */
function cashOf(description: string): number | null {
  const amount = /(\d+(?:\.\d+)?)\s*USD\b/.exec(description)?.[1];

  return amount === undefined ? null : Number(amount);
}

/**
 * US listings' quarterly statements and distributions from Longbridge's fundamentals, on the
 * user's sign-in. Longbridge gives no filing date, so a quarter is dated by its results' release.
 * Its balance sheet holds no current lines, borrowings or cash apart from short-term
 * investments, so those are empty, and the US reports no monthly revenue.
 */
export function createLongbridgeFundamentals({
  accessToken,
  fetch,
}: LongbridgeFundamentalsOptions): FundamentalsProvider {
  // Only a 429 throws, which is what has ky try it again; any other answer is read for its reason.
  const api = ky.create({
    baseUrl: API_URL,
    fetch,
    retry: { limit: RATE_LIMIT_RETRIES, maxRetryAfter: MAX_RETRY_AFTER_MS },
    throwHttpErrors: (status) => status === 429,
  });

  const budget = createRateLimiter({
    limit: REQUESTS_PER_SECOND,
    windowMs: 1000,
  });

  function code(symbol: SymbolRef): string {
    if (symbol.market !== Market.US) {
      throw new Error(`Longbridge has no fundamentals for ${symbol.market}`);
    }

    return `${symbol.symbol}.US`;
  }

  async function read<Schema extends z.ZodType>(
    path: string,
    searchParams: Record<string, string>,
    schema: Schema,
    what: string
  ): Promise<z.infer<Schema>> {
    const token = await accessToken();

    let response: Response;

    try {
      response = await budget(() =>
        api.get(path, {
          searchParams,
          headers: {
            authorization: `Bearer ${token}`,
            "x-dc-region": longbridgeDataCenter(token),
            "accept-language": LANGUAGE,
          },
        })
      );
    } catch (error) {
      if (!isHTTPError(error)) throw error;

      const reason =
        envelopeSchema.safeParse(error.data).data?.message ??
        `HTTP ${error.response.status}`;

      throw new Error(`Longbridge refused ${what}: ${reason}`, {
        cause: error,
      });
    }

    const envelope = envelopeSchema.safeParse(
      await response.json().catch(() => null)
    );

    if (!envelope.success) {
      throw new Error(
        `Longbridge answered ${what} with HTTP ${response.status}`
      );
    }

    if (envelope.data.code !== 0) {
      throw new Error(`Longbridge refused ${what}: ${envelope.data.message}`);
    }

    const data = schema.safeParse(envelope.data.data);

    if (!data.success) throw new Error(`Longbridge's ${what} did not read`);

    return data.data;
  }

  async function quarters(
    symbol: SymbolRef,
    kind: ReportKind,
    since: string
  ): Promise<Quarter[]> {
    const what = `the statements of ${symbol.symbol}`;

    const { list } = await read(
      "v1/quote/financial-reports",
      { symbol: code(symbol), kind, report: QUARTERS_REPORT },
      reportsSchema,
      what
    );

    const values = Object.values(list).flatMap(({ indicators }) =>
      indicators.flatMap(({ accounts }) =>
        accounts.flatMap(({ field, values: answered }) =>
          readRows(answered, periodValueSchema, "Longbridge", what).map(
            (value) => ({
              ...value,
              field,
            })
          )
        )
      )
    );

    return quartersOf(values).filter(({ periodEnd }) => periodEnd >= since);
  }

  async function actions(symbol: SymbolRef): Promise<Action[]> {
    const what = `the corporate actions of ${symbol.symbol}`;

    const { items } = await read(
      "v1/quote/company-act",
      { symbol: code(symbol), req_type: "1", version: "3" },
      actionsSchema,
      what
    );

    return readRows(items, actionRowSchema, "Longbridge", what);
  }

  return {
    id: "longbridge",
    markets: [Market.US],

    async getStatements(symbol, since): Promise<QuarterStatement[]> {
      const [filed, taken] = await Promise.all([
        quarters(symbol, ReportKind.Income, since),
        actions(symbol),
      ]);

      const releases = taken
        .flatMap(({ action, date }) => {
          const released = day(date);

          return action === RESULTS_RELEASED && released !== null
            ? [released]
            : [];
        })
        .toSorted();

      return filed.flatMap((quarter): QuarterStatement[] => {
        const revenue = line(quarter, "OperatingRevenue");

        if (revenue === null) return [];

        const margin = line(quarter, "GrossMgn");

        return [
          {
            periodEnd: quarter.periodEnd,
            knownFrom: publishedOn(quarter, releases),
            revenue,
            // A bank reports no gross margin.
            grossProfit: margin === null ? null : (revenue * margin) / 100,
            operatingIncome: line(quarter, "OperatingIncome"),
            netIncome: line(quarter, "NetProfit"),
            eps: line(quarter, "EPS"),
          },
        ];
      });
    },

    async getBalanceSheets(symbol, since): Promise<BalanceSheet[]> {
      const filed = await quarters(symbol, ReportKind.Balance, since);

      return filed.flatMap((quarter): BalanceSheet[] => {
        const totalAssets = line(quarter, "TotalAssets");
        const totalLiabilities = line(quarter, "TotalLiability");

        if (totalAssets === null) return [];

        return [
          {
            periodEnd: quarter.periodEnd,
            totalAssets,
            totalLiabilities,
            equity:
              totalLiabilities === null ? null : totalAssets - totalLiabilities,
            // Longbridge gives cash only with short-term investments.
            cash: null,
            receivables: line(quarter, "TotalReceiv"),
            inventories: line(quarter, "Inventory"),
            currentAssets: null,
            currentLiabilities: null,
            shortTermBorrowings: null,
            longTermBorrowings: null,
            bondsPayable: null,
          },
        ];
      });
    },

    async getCashFlows(symbol, since): Promise<CashFlow[]> {
      const filed = await quarters(symbol, ReportKind.Cash, since);

      return filed.flatMap((quarter): CashFlow[] => {
        const operating = line(quarter, "NetOperateCashFlow");
        const capitalExpenditure = line(quarter, "CapEx");

        if (operating === null) return [];

        return [
          {
            periodEnd: quarter.periodEnd,
            operating,
            // Longbridge counts what was paid as a negative flow.
            capitalExpenditure:
              capitalExpenditure === null ? null : Math.abs(capitalExpenditure),
            investing: line(quarter, "NetInvestCashFlow"),
            financing: line(quarter, "NetFinanceCashFlow"),
          },
        ];
      });
    },

    getMonthlyRevenue: async () => [],

    async getDividends(symbol, since): Promise<Dividend[]> {
      const what = `the distributions of ${symbol.symbol}`;

      const [{ list }, taken] = await Promise.all([
        read(
          "v1/quote/dividends",
          { symbol: code(symbol) },
          dividendsSchema,
          what
        ),
        actions(symbol),
      ]);

      // A distribution's days come under its id, the announcement the first of them.
      const announcements = new Map<string, string>();

      for (const { id, action, date } of taken) {
        const announced = day(date);

        if (action !== DISTRIBUTION || announced === null) continue;

        const known = announcements.get(id);

        if (known === undefined || announced < known) {
          announcements.set(id, announced);
        }
      }

      return readRows(list, dividendRowSchema, "Longbridge", what)
        .flatMap((row): Dividend[] => {
          const cash = cashOf(row.desc);
          const cashExDate = day(row.ex_date);
          const announced = announcements.get(row.id) ?? null;

          if (cash === null || cash <= 0) return [];

          if ((announced ?? cashExDate ?? "") < since) return [];

          return [
            {
              period: row.desc,
              announced,
              cash,
              stock: 0,
              cashExDate,
              cashPaidOn: day(row.payment_date),
              stockExDate: null,
            },
          ];
        })
        .toSorted((a, b) =>
          (a.announced ?? a.cashExDate ?? "").localeCompare(
            b.announced ?? b.cashExDate ?? ""
          )
        );
    },
  };
}
