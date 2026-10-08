import { groupBy } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import { RestrictionKind } from "@solyx/core/fundamentals";
import type {
  Dividend,
  FundamentalsProvider,
  MonthlyRevenue,
  QuarterStatement,
  TradingRestriction,
} from "@solyx/core/fundamentals";
import { Market, shiftDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { twFilingDeadline } from "@solyx/core/rules/tw";
import type { TradingCalendarProvider } from "@solyx/core/session";
import { createRateLimiter } from "@solyx/utils/rate-limit";

const FINMIND_API_URL = "https://api.finmindtrade.com/api/v4/";

// What FinMind allows an hour without a token, whatever the plan.
const ANONYMOUS_REQUESTS = 300;

const HOUR_MS = 60 * 60 * 1000;

export const FinMindPlan = {
  Free: "free",
  Backer: "backer",
  Sponsor: "sponsor",
  SponsorPro: "sponsor-pro",
} as const;

export type FinMindPlan = (typeof FinMindPlan)[keyof typeof FinMindPlan];

export const finMindPlanSchema = z.enum(FinMindPlan);

/** What a FinMind plan allows its token. */
export interface FinMindPlanLimits {
  id: FinMindPlan;
  requestsPerHour: number;
  /** Whether it reads the datasets FinMind keeps for paying members, such as dispositions and halts. */
  memberDatasets: boolean;
}

/** FinMind's published limits. */
export const FINMIND_PLANS = {
  [FinMindPlan.Free]: {
    id: FinMindPlan.Free,
    requestsPerHour: 600,
    memberDatasets: false,
  },
  [FinMindPlan.Backer]: {
    id: FinMindPlan.Backer,
    requestsPerHour: 1600,
    memberDatasets: true,
  },
  [FinMindPlan.Sponsor]: {
    id: FinMindPlan.Sponsor,
    requestsPerHour: 6000,
    memberDatasets: true,
  },
  [FinMindPlan.SponsorPro]: {
    id: FinMindPlan.SponsorPro,
    requestsPerHour: 20_000,
    memberDatasets: true,
  },
} satisfies { [Plan in FinMindPlan]: FinMindPlanLimits & { id: Plan } };

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

// A suspension of selling short or of day trading that sells first, from its first day to its last.
const suspensionRowSchema = z.object({
  stock_id: z.string(),
  date: z.iso.date(),
  end_date: z.iso.date(),
  reason: z.string(),
});

const dispositionRowSchema = z.object({
  stock_id: z.string(),
  measure: z.string(),
  period_start: z.iso.date(),
  period_end: z.iso.date(),
});

// FinMind leaves the day trading resumes empty while none is set.
const haltRowSchema = z.object({
  stock_id: z.string(),
  date: z.iso.date(),
  resumption_date: dayOrUnsetSchema,
});

const failureSchema = z.object({ msg: z.string() });

// Net income attributable to the parent's owners, then the whole group's where FinMind names only that.
const NET_INCOME_LINES = [
  "EquityAttributableToOwnersOfParent",
  "IncomeAfterTaxes",
  "IncomeAfterTax",
];

const maxDate = (a: string, b: string) => (a > b ? a : b);

export interface FinMindOptions {
  /** The user's FinMind token, read for every request; `undefined` asks without one, under the lowest limit and as the free plan. */
  token?: () => Promise<string | undefined>;
  /**
   * The plan the token belongs to, read for every request, which sets the limit and the datasets read.
   * @default () => FinMindPlan.Free
   */
  plan?: () => FinMindPlan;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * Taiwan listings' quarterly income statements, monthly revenue, dividends and restrictions, and
 * the days the exchange trades, from FinMind on the user's token and plan or none.
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

  // Each limit is FinMind's own, counted per hour, so each is kept apart.
  const budgets = new Map<number, ReturnType<typeof createRateLimiter>>();

  const budget = (limit: number) => {
    const held = budgets.get(limit);

    if (held) return held;

    const created = createRateLimiter({ limit, windowMs: HOUR_MS });

    budgets.set(limit, created);

    return created;
  };

  /** What the user's token, or none, allows. */
  async function access() {
    const token = await options.token?.();

    if (token === undefined) {
      return {
        token,
        requestsPerHour: ANONYMOUS_REQUESTS,
        memberDatasets: false,
      };
    }

    return { token, ...FINMIND_PLANS[options.plan?.() ?? FinMindPlan.Free] };
  }

  /** A dataset's rows, each dropped unless it parses. */
  async function data<Row>(
    dataset: string,
    params: Record<string, string>,
    schema: z.ZodType<Row>
  ): Promise<Row[]> {
    const { token, requestsPerHour } = await access();

    const response = await budget(requestsPerHour)(() =>
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

    async getRestrictions(symbol, since) {
      if (symbol.market !== Market.TW) return [];

      const own = ({ stock_id }: { stock_id: string }) =>
        stock_id === symbol.symbol;

      const suspensions = (dataset: string, kind: RestrictionKind) =>
        rows(dataset, symbol, since, suspensionRowSchema).then((found) =>
          found.filter(own).map((row): TradingRestriction => ({
            kind,
            from: row.date,
            until: row.end_date,
            note: row.reason || null,
          }))
        );

      const reads = [
        suspensions(
          "TaiwanStockMarginShortSaleSuspension",
          RestrictionKind.ShortSaleSuspension
        ),
      ];

      // The rest are for paying members; each is asked by listing and checked by code, since a dataset may answer for every listing at once.
      if ((await access()).memberDatasets) {
        reads.push(
          suspensions(
            "TaiwanStockDayTradingSuspension",
            RestrictionKind.DayTradingSuspension
          ),
          rows(
            "TaiwanStockDispositionSecuritiesPeriod",
            symbol,
            since,
            dispositionRowSchema
          ).then((found) =>
            found.filter(own).map((row): TradingRestriction => ({
              kind: RestrictionKind.Disposition,
              from: row.period_start,
              until: row.period_end,
              note: row.measure || null,
            }))
          ),
          rows("TaiwanStockSuspended", symbol, since, haltRowSchema).then(
            (found) =>
              found.filter(own).map((row): TradingRestriction => ({
                kind: RestrictionKind.Halt,
                from: row.date,
                // Halted through the day before trading resumes, which may be the day it began.
                until:
                  row.resumption_date === null
                    ? null
                    : maxDate(row.date, shiftDate(row.resumption_date, -1)),
                note: null,
              }))
          )
        );
      }

      return (await Promise.all(reads))
        .flat()
        .toSorted((a, b) => a.from.localeCompare(b.from));
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
