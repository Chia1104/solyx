import { groupBy } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import type {
  Dividend,
  FundamentalsProvider,
  MonthlyRevenue,
  QuarterStatement,
} from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { twFilingDeadline } from "@solyx/core/rules/tw";
import type { TradingCalendarProvider } from "@solyx/core/session";
import { createRateLimiter } from "@solyx/utils/rate-limit";

const FINMIND_API_URL = "https://api.finmindtrade.com/api/v4/";

// What FinMind allows an hour: without a token, and with a registered one.
const ANONYMOUS_REQUESTS = 300;

const TOKEN_REQUESTS = 600;

const HOUR_MS = 60 * 60 * 1000;

const responseSchema = z.object({ data: z.array(z.unknown()) });

// One line of a statement: the quarter's last day, the line's name and its figure for that quarter alone.
const statementRowSchema = z.object({
  date: z.iso.date(),
  type: z.string(),
  value: z.number(),
});

// FinMind dates a month's revenue by when it was announced, so the month is read from its own fields.
const revenueRowSchema = z.object({
  revenue: z.number(),
  revenue_year: z.number().int(),
  revenue_month: z.number().int().min(1).max(12),
});

// FinMind leaves a day that is not set, or does not apply, empty.
const dayOrUnsetSchema = z.union([
  z.iso.date(),
  z.literal("").transform(() => null),
]);

// One distribution, its amounts per share, cash and stock each from earnings and from surplus.
const dividendRowSchema = z.object({
  year: z.string(),
  AnnouncementDate: z.iso.date(),
  CashEarningsDistribution: z.number(),
  CashStatutorySurplus: z.number(),
  StockEarningsDistribution: z.number(),
  StockStatutorySurplus: z.number(),
  CashExDividendTradingDate: dayOrUnsetSchema,
  CashDividendPaymentDate: dayOrUnsetSchema,
  StockExDividendTradingDate: dayOrUnsetSchema,
});

const tradingDateRowSchema = z.object({ date: z.iso.date() });

const failureSchema = z.object({ msg: z.string() });

// Net income attributable to the parent's owners, then the whole group's where FinMind names only that.
const NET_INCOME_LINES = [
  "EquityAttributableToOwnersOfParent",
  "IncomeAfterTaxes",
  "IncomeAfterTax",
];

export interface FinMindOptions {
  /** The user's FinMind token, read for every request; `undefined` asks without one, under the lower limit. */
  token?: () => Promise<string | undefined>;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * Taiwan listings' quarterly income statements, monthly revenue and dividends, and the days the
 * exchange trades, from FinMind on the user's token or none.
 */
export function createFinMind(
  options: FinMindOptions = {}
): FundamentalsProvider & TradingCalendarProvider {
  const api = ky.create({
    baseUrl: FINMIND_API_URL,
    fetch: options.fetch,
    hooks: {
      beforeError: [
        ({ error }) => {
          if (!isHTTPError(error)) {
            error.message = `FinMind: ${error.message}`;

            return error;
          }

          const reason = failureSchema.safeParse(error.data).data?.msg;

          error.message = `FinMind answered ${error.response.status}${reason ? `: ${reason}` : ""}`;

          return error;
        },
      ],
    },
  });

  // Each limit is FinMind's own, counted per hour, so the two are kept apart.
  const budgets = {
    anonymous: createRateLimiter({
      limit: ANONYMOUS_REQUESTS,
      windowMs: HOUR_MS,
    }),
    token: createRateLimiter({ limit: TOKEN_REQUESTS, windowMs: HOUR_MS }),
  };

  /** A dataset's rows, each dropped unless it parses. */
  async function data<Row>(
    dataset: string,
    params: Record<string, string>,
    schema: z.ZodType<Row>
  ): Promise<Row[]> {
    const token = await options.token?.();
    const budget = token === undefined ? budgets.anonymous : budgets.token;

    const response = await budget(() =>
      api
        .get("data", {
          headers:
            token === undefined ? {} : { Authorization: `Bearer ${token}` },
          searchParams: { dataset, ...params },
        })
        .json()
    );

    return responseSchema.parse(response).data.flatMap((row) => {
      const parsed = schema.safeParse(row);

      return parsed.success ? [parsed.data] : [];
    });
  }

  /** A dataset's rows for one listing from `since` on. */
  async function rows<Row>(
    dataset: string,
    symbol: SymbolRef,
    since: string,
    schema: z.ZodType<Row>
  ): Promise<Row[]> {
    if (symbol.market !== Market.TW) return [];

    return data(dataset, { data_id: symbol.symbol, start_date: since }, schema);
  }

  return {
    id: "finmind",
    markets: [Market.TW],

    async getStatements(symbol, since) {
      const lines = await rows(
        "TaiwanStockFinancialStatements",
        symbol,
        since,
        statementRowSchema
      );

      return Object.entries(groupBy(lines, (line) => line.date))
        .toSorted(([a], [b]) => a.localeCompare(b))
        .flatMap(([periodEnd, quarter]): QuarterStatement[] => {
          const line = (...names: string[]) =>
            names
              .map((name) => quarter.find((each) => each.type === name)?.value)
              .find((value) => value !== undefined) ?? null;

          const revenue = line("Revenue");

          if (revenue === null) return [];

          return [
            {
              periodEnd,
              knownFrom: twFilingDeadline(periodEnd),
              revenue,
              grossProfit: line("GrossProfit"),
              operatingIncome: line("OperatingIncome"),
              netIncome: line(...NET_INCOME_LINES),
              eps: line("EPS"),
            },
          ];
        });
    },

    async getMonthlyRevenue(symbol, since) {
      const months = await rows(
        "TaiwanStockMonthRevenue",
        symbol,
        // A month is announced early in the next, which is the date FinMind files it under.
        `${since}-01`,
        revenueRowSchema
      );

      return months
        .map((row): MonthlyRevenue => ({
          month: `${row.revenue_year}-${String(row.revenue_month).padStart(2, "0")}`,
          revenue: row.revenue,
        }))
        .filter(({ month }) => month >= since)
        .toSorted((a, b) => a.month.localeCompare(b.month));
    },

    async getDividends(symbol, since) {
      // FinMind dates a distribution after it goes ex, so asking from `since` finds every one announced since.
      const distributions = await rows(
        "TaiwanStockDividend",
        symbol,
        since,
        dividendRowSchema
      );

      return distributions
        .map((row): Dividend => ({
          period: row.year,
          announced: row.AnnouncementDate,
          cash: row.CashEarningsDistribution + row.CashStatutorySurplus,
          stock: row.StockEarningsDistribution + row.StockStatutorySurplus,
          cashExDate: row.CashExDividendTradingDate,
          cashPaidOn: row.CashDividendPaymentDate,
          stockExDate: row.StockExDividendTradingDate,
        }))
        .filter(
          ({ announced, cash, stock }) => announced >= since && cash + stock > 0
        )
        .toSorted((a, b) => a.announced.localeCompare(b.announced));
    },

    async tradingDays(market, since) {
      if (market !== Market.TW) return [];

      const days = await data(
        "TaiwanStockTradingDate",
        { start_date: since },
        tradingDateRowSchema
      );

      return days.map(({ date }) => date).toSorted();
    },
  };
}
