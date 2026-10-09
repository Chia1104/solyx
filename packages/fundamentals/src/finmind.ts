import { groupBy, sumBy } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import {
  Investor,
  emptyListingFlows,
  emptyMarketFlows,
} from "@solyx/core/flows";
import type {
  FlowsProvider,
  FuturesPosition,
  InvestorTrades,
  MarketMargin,
} from "@solyx/core/flows";
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
import { TW_BOARD_LOT, twFilingDeadline } from "@solyx/core/rules/tw";
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

// One group's buying and selling in a session: of a listing in shares, or of the whole market in New Taiwan dollars.
const tradesRowSchema = z.object({
  date: z.iso.date(),
  name: z.string(),
  buy: z.number(),
  sell: z.number(),
});

const listingTradesRowSchema = tradesRowSchema.extend({ stock_id: z.string() });

// A listing's margin and short balances at the close, in board lots.
const marginRowSchema = z.object({
  stock_id: z.string(),
  date: z.iso.date(),
  MarginPurchaseTodayBalance: z.number(),
  MarginPurchaseLimit: z.number(),
  ShortSaleTodayBalance: z.number(),
});

// Foreign investors' holding and its limit, in percent of the shares issued.
const shareholdingRowSchema = z.object({
  stock_id: z.string(),
  date: z.iso.date(),
  ForeignInvestmentSharesRatio: z.number(),
  ForeignInvestmentUpperLimitRatio: z.number(),
});

// One of the market's balances at the close: `MarginPurchase` and `ShortSale` in board lots, `MarginPurchaseMoney` in New Taiwan dollars.
const marketMarginRowSchema = z.object({
  date: z.iso.date(),
  name: z.string(),
  TodayBalance: z.number(),
});

const futuresRowSchema = z.object({
  date: z.iso.date(),
  institutional_investors: z.string(),
  long_open_interest_balance_volume: z.number(),
  short_open_interest_balance_volume: z.number(),
});

const failureSchema = z.object({ msg: z.string() });

// FinMind's names for the groups trading on the exchange; a foreign group's dealers count with it, and `total` is left out.
const EXCHANGE_INVESTORS = new Map<string, Investor>([
  ["Foreign_Investor", Investor.Foreign],
  ["Foreign_Dealer_Self", Investor.Foreign],
  ["Investment_Trust", Investor.InvestmentTrust],
  ["Dealer_self", Investor.Dealer],
  ["Dealer_Hedging", Investor.DealerHedging],
]);

// The futures exchange's names for the groups, which it does not split by hedging.
const FUTURES_INVESTORS = new Map<string, Investor>([
  ["外資", Investor.Foreign],
  ["投信", Investor.InvestmentTrust],
  ["自營商", Investor.Dealer],
]);

// TAIEX futures.
const INDEX_FUTURE = "TX";

const byDate = <Row extends { date: string }>(a: Row, b: Row) =>
  a.date.localeCompare(b.date);

/** Each group's trades per session, oldest first, the rows FinMind splits a group into added up. */
function investorTrades(
  rows: readonly z.infer<typeof tradesRowSchema>[]
): InvestorTrades[] {
  const named = rows.flatMap((row): InvestorTrades[] => {
    const investor = EXCHANGE_INVESTORS.get(row.name);

    return investor === undefined
      ? []
      : [{ date: row.date, investor, bought: row.buy, sold: row.sell }];
  });

  return Object.values(
    groupBy(named, ({ date, investor }) => `${date}:${investor}`)
  )
    .map(([first, ...rest]): InvestorTrades => ({
      ...first,
      bought: first.bought + sumBy(rest, ({ bought }) => bought),
      sold: first.sold + sumBy(rest, ({ sold }) => sold),
    }))
    .toSorted(byDate);
}

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
 * Taiwan listings' quarterly income statements, monthly revenue, dividends and restrictions, who
 * trades them and the market, and the days the exchange trades, from FinMind on the user's token
 * and plan or none.
 */
export function createFinMind(
  options: FinMindOptions = {}
): FundamentalsProvider & FlowsProvider & TradingCalendarProvider {
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

    async getListingFlows(symbol, since) {
      if (symbol.market !== Market.TW) return emptyListingFlows();

      const own = ({ stock_id }: { stock_id: string }) =>
        stock_id === symbol.symbol;

      const [trades, margin, foreign] = await Promise.all([
        rows(
          "TaiwanStockInstitutionalInvestorsBuySell",
          symbol,
          since,
          listingTradesRowSchema
        ),
        rows(
          "TaiwanStockMarginPurchaseShortSale",
          symbol,
          since,
          marginRowSchema
        ),
        rows("TaiwanStockShareholding", symbol, since, shareholdingRowSchema),
      ]);

      return {
        trades: investorTrades(trades.filter(own)),
        margin: margin
          .filter(own)
          .map((row) => ({
            date: row.date,
            margin: row.MarginPurchaseTodayBalance * TW_BOARD_LOT,
            marginLimit: row.MarginPurchaseLimit * TW_BOARD_LOT,
            short: row.ShortSaleTodayBalance * TW_BOARD_LOT,
          }))
          .toSorted(byDate),
        foreign: foreign
          .filter(own)
          .map((row) => ({
            date: row.date,
            ratio: row.ForeignInvestmentSharesRatio / 100,
            limit: row.ForeignInvestmentUpperLimitRatio / 100,
          }))
          .toSorted(byDate),
      };
    },

    async getMarketFlows(market, since) {
      if (market !== Market.TW) return emptyMarketFlows();

      const [trades, balances, futures] = await Promise.all([
        data(
          "TaiwanStockTotalInstitutionalInvestors",
          { start_date: since },
          tradesRowSchema
        ),
        data(
          "TaiwanStockTotalMarginPurchaseShortSale",
          { start_date: since },
          marketMarginRowSchema
        ),
        data(
          "TaiwanFuturesInstitutionalInvestors",
          { data_id: INDEX_FUTURE, start_date: since },
          futuresRowSchema
        ),
      ]);

      // A session missing one of its balances is dropped, so every one reads whole.
      const margin = Object.entries(
        groupBy(balances, ({ date }) => date)
      ).flatMap(([date, session]): MarketMargin[] => {
        const balance = (name: string) =>
          session.find((row) => row.name === name)?.TodayBalance;

        const marginValue = balance("MarginPurchaseMoney");
        const shares = balance("MarginPurchase");
        const short = balance("ShortSale");

        return marginValue === undefined ||
          shares === undefined ||
          short === undefined
          ? []
          : [
              {
                date,
                marginValue,
                margin: shares * TW_BOARD_LOT,
                short: short * TW_BOARD_LOT,
              },
            ];
      });

      return {
        trades: investorTrades(trades),
        margin: margin.toSorted(byDate),
        futures: futures
          .flatMap((row): FuturesPosition[] => {
            const investor = FUTURES_INVESTORS.get(row.institutional_investors);

            return investor === undefined
              ? []
              : [
                  {
                    date: row.date,
                    investor,
                    long: row.long_open_interest_balance_volume,
                    short: row.short_open_interest_balance_volume,
                  },
                ];
          })
          .toSorted(byDate),
      };
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
