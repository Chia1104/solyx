import { groupBy } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import type {
  FundamentalsProvider,
  MonthlyRevenue,
  QuarterStatement,
} from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { twFilingDeadline } from "@solyx/core/rules/tw";
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

/** Taiwan listings' quarterly income statements and monthly revenue from FinMind, on the user's token or none. */
export function createFinMind(
  options: FinMindOptions = {}
): FundamentalsProvider {
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

  /** A dataset's rows for one listing from `since` on, each dropped unless it parses. */
  async function rows<Row>(
    dataset: string,
    symbol: SymbolRef,
    since: string,
    schema: z.ZodType<Row>
  ): Promise<Row[]> {
    if (symbol.market !== Market.TW) return [];

    const token = await options.token?.();
    const budget = token === undefined ? budgets.anonymous : budgets.token;

    const response = await budget(() =>
      api
        .get("data", {
          headers:
            token === undefined ? {} : { Authorization: `Bearer ${token}` },
          searchParams: {
            dataset,
            data_id: symbol.symbol,
            start_date: since,
          },
        })
        .json()
    );

    return responseSchema.parse(response).data.flatMap((row) => {
      const parsed = schema.safeParse(row);

      return parsed.success ? [parsed.data] : [];
    });
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
  };
}
