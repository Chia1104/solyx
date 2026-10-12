import { median, sumBy } from "es-toolkit";

import { candleDate } from "./candles.ts";
import type { Candle } from "./candles.ts";
import type { Market, SymbolRef } from "./market.ts";

/** One quarter's income statement, for that quarter alone, in the market's currency. */
export interface QuarterStatement {
  /** The quarter's last day, `YYYY-MM-DD`. */
  periodEnd: string;
  /** The exchange-local date its figures were public: the filing's where the provider tells it, else the filing deadline. */
  knownFrom: string;
  revenue: number;
  /** `null` where the industry reports none, as banks do. */
  grossProfit: number | null;
  operatingIncome: number | null;
  /** Attributable to the parent's owners. */
  netIncome: number | null;
  /** Basic, per share. */
  eps: number | null;
}

/** What a company held and owed on a quarter's last day, in the market's currency; a line is `null` where it reports none, as a bank reports no inventories. */
export interface BalanceSheet {
  /** The quarter's last day, `YYYY-MM-DD`. */
  periodEnd: string;
  totalAssets: number;
  totalLiabilities: number | null;
  /** The owners' and the non-controlling interests' together. */
  equity: number | null;
  cash: number | null;
  /** Trade receivables, net, those due from related parties among them. */
  receivables: number | null;
  inventories: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  /**
   * The three borrowing lines as filed. Long-term debt due within a year is filed apart from
   * them, so they do not add up to all a company owes lenders.
   */
  shortTermBorrowings: number | null;
  longTermBorrowings: number | null;
  bondsPayable: number | null;
}

/** One quarter's cash flows, for that quarter alone, in the market's currency. */
export interface CashFlow {
  /** The quarter's last day, `YYYY-MM-DD`. */
  periodEnd: string;
  /** From operations; negative where they used cash. */
  operating: number;
  /** Paid for property, plant and equipment, as a positive amount; `null` where none is reported. */
  capitalExpenditure: number | null;
  investing: number | null;
  financing: number | null;
}

export interface MonthlyRevenue {
  /** `YYYY-MM`. */
  month: string;
  revenue: number;
}

/** A distribution the company decided on, per share, with the days its shares trade without it. */
export interface Dividend {
  /** The period whose earnings it distributes, as the company names it, such as `114年第2季`. */
  period: string;
  /** The exchange-local date it was announced, `YYYY-MM-DD`; `null` where the provider gives none, as for a fund's. */
  announced: string | null;
  /** Cash per share, in the market's currency. */
  cash: number;
  /** Shares distributed per share, at their par value in the market's currency. */
  stock: number;
  /** The first session the shares trade without the cash; `null` while there is none or it is not set. */
  cashExDate: string | null;
  /** `null` while there is no cash or the day is not set. */
  cashPaidOn: string | null;
  /** The first session the shares trade without the stock; `null` while there is none or it is not set. */
  stockExDate: string | null;
}

/** A limit the exchange puts on how a listing trades. */
export const RestrictionKind = {
  /** Selling short on margin is suspended, as around an ex-date or a shareholders' meeting. */
  ShortSaleSuspension: "short-sale-suspension",
  /** Day trading that sells before it buys is suspended. */
  DayTradingSuspension: "day-trading-suspension",
  /** The listing is under disposition: its orders match in batches, and may need paying for in advance. */
  Disposition: "disposition",
  /** Trading is halted. */
  Halt: "halt",
} as const;

export type RestrictionKind =
  (typeof RestrictionKind)[keyof typeof RestrictionKind];

export interface TradingRestriction {
  kind: RestrictionKind;
  /** The first day it applies, `YYYY-MM-DD` on the exchange's calendar. */
  from: string;
  /** The last day it applies; `null` while no end is set. */
  until: string | null;
  /** Why, or what it imposes, in the exchange's words; `null` where it gives none. */
  note: string | null;
}

/** One implementation per provider (`@solyx/fundamentals/*`); it runs only in the main process. */
export interface FundamentalsProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Quarters ending on or after `since` (`YYYY-MM-DD`), oldest first; none for a listing without statements, such as an ETF. */
  getStatements(symbol: SymbolRef, since: string): Promise<QuarterStatement[]>;
  /** Balance sheets of quarters ending on or after `since` (`YYYY-MM-DD`), oldest first; none for a listing without statements. */
  getBalanceSheets(symbol: SymbolRef, since: string): Promise<BalanceSheet[]>;
  /** Cash flows of quarters ending on or after `since` (`YYYY-MM-DD`), oldest first; none for a listing without statements. */
  getCashFlows(symbol: SymbolRef, since: string): Promise<CashFlow[]>;
  /** Months from `since` (`YYYY-MM`) on, oldest first; none where the market reports none. */
  getMonthlyRevenue(
    symbol: SymbolRef,
    since: string
  ): Promise<MonthlyRevenue[]>;
  /** Distributions announced on or after `since` (`YYYY-MM-DD`), or dated so by the provider where none says when, oldest first, those still to go ex among them. */
  getDividends(symbol: SymbolRef, since: string): Promise<Dividend[]>;
}

/** What a fund is, as its exchange lists it. */
export interface FundProfile {
  /** Its full name. */
  name: string;
  /** The kind of fund in the exchange's words, such as `槓桿/反向指數股票型基金`. */
  category: string;
  /** The index it tracks; `null` for a fund that tracks none, as an actively managed one. */
  index: string | null;
  /** What an actively managed fund measures itself against; `null` where it names nothing. */
  benchmark: string | null;
  /** Whether it may hold securities listed abroad; `null` where the exchange does not say. */
  foreignHoldings: boolean | null;
  manager: string | null;
  /** The exchange-local date it listed, `YYYY-MM-DD`; `null` where the exchange gives none. */
  listedOn: string | null;
  /** Units outstanding on `asOf`; `null` where the exchange gives none. */
  units: number | null;
  /** The exchange-local date the exchange drew its list up, `YYYY-MM-DD`. */
  asOf: string;
}

/** Where a listing's price stands against its earnings, dividends and book value, as its exchange works them out from a session's close. */
export interface ExchangeMultiples {
  /** The session whose close they are of, `YYYY-MM-DD` on the exchange's calendar. */
  asOf: string;
  /** `null` where the exchange works none out, as for a company whose earnings add up to a loss. */
  priceToEarnings: number | null;
  /** The dividend the exchange counts for a share over the close, in percent; `null` where it gives none. */
  dividendYield: number | null;
  priceToBook: number | null;
}

/** An exchange's notice of the first session a listing's shares trade without a distribution or a right. */
export interface ExNotice {
  /** That session's day, `YYYY-MM-DD` on the exchange's calendar. */
  date: string;
  /** Whether the shares go ex a cash distribution that day. */
  exDividend: boolean;
  /** Whether the shares go ex a right that day: a stock dividend, or subscribing to newly issued shares. */
  exRights: boolean;
  /** Cash per share, in the market's currency; `null` where the shares go ex none, or its amount is not announced yet. */
  cash: number | null;
}

/** A shareholders' meeting a company has called, as its exchange lists it. */
export interface ShareholdersMeeting {
  /** The day it is held, `YYYY-MM-DD` on the exchange's calendar. */
  date: string;
  /** Whether it is the year's regular meeting, or one called apart from it. */
  regular: boolean;
  /** Whether it elects directors. */
  election: boolean;
}

/** The industry an exchange classes a company in. */
export interface Industry {
  /** The exchange's own code for it, which is what companies of one industry share. */
  code: string;
  /** What the exchange calls it. */
  name: string;
}

/** Where one of a listing's multiples stands among the same multiple of its industry's other listings. */
export interface MultipleStanding {
  /** The listing's own; `null` where its exchange works none out. */
  value: number | null;
  /** How many of the others have one. */
  peers: number;
  /** Theirs in the middle; `null` where none has one. */
  median: number | null;
  /** The share of theirs the listing's is above; `null` where it has none or none of them does. */
  above: number | null;
}

/** A listing's multiples against those of the other listings its exchanges class in its industry. */
export interface PeerStanding {
  industry: Industry;
  /** How many listings the exchanges class there, itself among them. */
  listings: number;
  /** The session the listing's own multiples are of. */
  asOf: string;
  priceToEarnings: MultipleStanding;
  dividendYield: MultipleStanding;
  priceToBook: MultipleStanding;
}

/** A row of an exchange's list with the listing it is about, since an exchange lists its whole market's at once. */
export type Listed<Row> = Row & {
  /** The listing's exchange code, as a `SymbolRef` writes it. */
  symbol: string;
};

/**
 * One implementation per source of the exchanges' own lists (`@solyx/fundamentals/*`); it runs only
 * in the main process. Each list is a market's whole as its exchanges publish it today, and empty
 * for a market the source does not cover.
 */
export interface ExchangeListsProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Oldest first: the restrictions in force, those announced, and whichever ended ones the lists still hold. */
  getRestrictions(market: Market): Promise<Listed<TradingRestriction>[]>;
  /** Every fund the exchanges list. */
  getFunds(market: Market): Promise<Listed<FundProfile>[]>;
  /** Every listing the exchanges work multiples out for. */
  getMultiples(market: Market): Promise<Listed<ExchangeMultiples>[]>;
  /** The notices the exchanges hold of shares going ex, those of days just past among them. */
  getExNotices(market: Market): Promise<Listed<ExNotice>[]>;
  /** The shareholders' meetings the exchanges list, those already held among them. */
  getMeetings(market: Market): Promise<Listed<ShareholdersMeeting>[]>;
  /** The industry the exchanges class each company in. */
  getIndustries(market: Market): Promise<Listed<Industry>[]>;
}

/** A listing's fundamentals from whichever provider covers its market, oldest first; none while no provider does. */
export interface Fundamentals {
  /** The id of the provider that covers a market; `undefined` while none does, which is why its listings have nothing to read. */
  source(market: Market): string | undefined;
  /** Enough quarters to compare each recent one with the year before. */
  statements(symbol: SymbolRef): Promise<QuarterStatement[]>;
  /** Enough quarters for each recent one to have the three before it. */
  balanceSheets(symbol: SymbolRef): Promise<BalanceSheet[]>;
  cashFlows(symbol: SymbolRef): Promise<CashFlow[]>;
  monthlyRevenue(symbol: SymbolRef): Promise<MonthlyRevenue[]>;
  /** As many years of distributions as of quarters. */
  dividends(symbol: SymbolRef): Promise<Dividend[]>;
  /** What its exchange lists today, oldest first: the restrictions in force and those announced; none while no source lists its market's. */
  restrictions(symbol: SymbolRef): Promise<TradingRestriction[]>;
  /** What the listing is as a fund; `null` for one no source lists as a fund, which a stock is and a fund its exchange publishes no list of may be. */
  fund(symbol: SymbolRef): Promise<FundProfile | null>;
  /** Its multiples from the last close its exchange has worked them out for; `null` for a listing no source lists any for, which a fund is. */
  multiples(symbol: SymbolRef): Promise<ExchangeMultiples | null>;
  /** The notices its exchange holds of its shares going ex; none while no source lists its market's. */
  exNotices(symbol: SymbolRef): Promise<ExNotice[]>;
  /** The shareholders' meetings its exchange lists for it; none while no source lists its market's. */
  meetings(symbol: SymbolRef): Promise<ShareholdersMeeting[]>;
  /** Its multiples against its industry's; `null` for a listing its exchanges class in none or work no multiples out for, which a fund is. */
  peers(symbol: SymbolRef): Promise<PeerStanding | null>;
}

function standing(
  value: number | null,
  others: readonly (number | null)[]
): MultipleStanding {
  const theirs = others.filter((each) => each !== null);

  return {
    value,
    peers: theirs.length,
    median: theirs.length === 0 ? null : median(theirs),
    above:
      value === null || theirs.length === 0
        ? null
        : theirs.filter((each) => each < value).length / theirs.length,
  };
}

/** A listing's multiples against those of its industry's other listings, each multiple among the ones that have it. */
export function peerStanding(
  own: ExchangeMultiples,
  others: readonly ExchangeMultiples[]
): Pick<PeerStanding, "priceToEarnings" | "dividendYield" | "priceToBook"> {
  return {
    priceToEarnings: standing(
      own.priceToEarnings,
      others.map((each) => each.priceToEarnings)
    ),
    dividendYield: standing(
      own.dividendYield,
      others.map((each) => each.dividendYield)
    ),
    priceToBook: standing(
      own.priceToBook,
      others.map((each) => each.priceToBook)
    ),
  };
}

/** A quarter with what it says against the quarters around it; `null` where a figure it needs is missing. */
export interface StatementMetrics {
  statement: QuarterStatement;
  revenueYoY: number | null;
  revenueQoQ: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  epsYoY: number | null;
  /** This quarter's EPS and the three before it. */
  trailingEps: number | null;
}

/** A balance sheet with what its lines say against each other; `null` where a line it needs is missing. */
export interface BalanceSheetMetrics {
  sheet: BalanceSheet;
  /** Current assets over current liabilities. */
  currentRatio: number | null;
  liabilitiesToAssets: number | null;
}

/** A quarter's cash flows with what they leave and the year they close; `null` where a figure it needs is missing. */
export interface CashFlowMetrics {
  flow: CashFlow;
  /** Operating cash flow less capital expenditure. */
  freeCashFlow: number | null;
  /** This quarter's operating cash flow and the three before it. */
  trailingOperating: number | null;
  trailingFreeCashFlow: number | null;
}

export interface RevenueTrend {
  month: string;
  revenue: number;
  yoy: number | null;
  mom: number | null;
}

/** The change from `before` as a share of it, measured against its size so a loss turning to profit reads as a rise. */
function growth(
  now: number | null | undefined,
  before: number | null | undefined
): number | null {
  if (now === null || now === undefined) return null;

  if (before === null || before === undefined || before === 0) return null;

  return (now - before) / Math.abs(before);
}

const share = (part: number | null, whole: number) =>
  part === null || whole === 0 ? null : part / whole;

/** `YYYY-MM` moved by whole months. */
const shiftMonth = (month: string, months: number) =>
  Temporal.PlainYearMonth.from(month).add({ months }).toString();

const monthOf = ({ periodEnd }: { periodEnd: string }) => periodEnd.slice(0, 7);

/** The sum of four quarters' figures; `null` where one is missing. */
function yearOf(
  quarters: readonly (number | null | undefined)[]
): number | null {
  let sum = 0;

  for (const each of quarters) {
    if (each === null || each === undefined) return null;

    sum += each;
  }

  return sum;
}

/** Each quarter against the one before and the one a year before, oldest first as given. */
export function statementMetrics(
  statements: readonly QuarterStatement[]
): StatementMetrics[] {
  const byMonth = new Map(
    statements.map((statement) => [monthOf(statement), statement])
  );

  return statements.map((statement) => {
    const month = monthOf(statement);
    const before = (months: number) => byMonth.get(shiftMonth(month, -months));
    const yearAgo = before(12);

    const year = [statement, before(3), before(6), before(9)];

    return {
      statement,
      revenueYoY: growth(statement.revenue, yearAgo?.revenue),
      revenueQoQ: growth(statement.revenue, before(3)?.revenue),
      grossMargin: share(statement.grossProfit, statement.revenue),
      operatingMargin: share(statement.operatingIncome, statement.revenue),
      netMargin: share(statement.netIncome, statement.revenue),
      epsYoY: growth(statement.eps, yearAgo?.eps),
      trailingEps: yearOf(year.map((quarter) => quarter?.eps)),
    };
  });
}

/** Each balance sheet's ratios, oldest first as given. */
export function balanceSheetMetrics(
  sheets: readonly BalanceSheet[]
): BalanceSheetMetrics[] {
  return sheets.map((sheet) => ({
    sheet,
    currentRatio:
      sheet.currentLiabilities === null
        ? null
        : share(sheet.currentAssets, sheet.currentLiabilities),
    liabilitiesToAssets: share(sheet.totalLiabilities, sheet.totalAssets),
  }));
}

const freeCashFlow = ({ operating, capitalExpenditure }: CashFlow) =>
  capitalExpenditure === null ? null : operating - capitalExpenditure;

/** Each quarter's free cash flow and the four quarters it closes, oldest first as given. */
export function cashFlowMetrics(flows: readonly CashFlow[]): CashFlowMetrics[] {
  const byMonth = new Map(flows.map((flow) => [monthOf(flow), flow]));

  return flows.map((flow) => {
    const month = monthOf(flow);

    const year = [0, 3, 6, 9].map((months) =>
      byMonth.get(shiftMonth(month, -months))
    );

    return {
      flow,
      freeCashFlow: freeCashFlow(flow),
      trailingOperating: yearOf(year.map((quarter) => quarter?.operating)),
      trailingFreeCashFlow: yearOf(
        year.map((quarter) => quarter && freeCashFlow(quarter))
      ),
    };
  });
}

/** Each month against the one before and the same month a year before, oldest first as given. */
export function revenueTrend(
  monthly: readonly MonthlyRevenue[]
): RevenueTrend[] {
  const byMonth = new Map(monthly.map((each) => [each.month, each.revenue]));

  return monthly.map(({ month, revenue }) => ({
    month,
    revenue,
    yoy: growth(revenue, byMonth.get(shiftMonth(month, -12))),
    mom: growth(revenue, byMonth.get(shiftMonth(month, -1))),
  }));
}

/** Cash per share of the distributions that went ex in the year through `date` (`YYYY-MM-DD`). */
export function trailingCash(
  dividends: readonly Dividend[],
  date: string
): number {
  const yearBefore = Temporal.PlainDate.from(date)
    .subtract({ years: 1 })
    .toString();

  return sumBy(
    dividends.filter(
      ({ cashExDate }) =>
        cashExDate !== null && cashExDate > yearBefore && cashExDate <= date
    ),
    ({ cash }) => cash
  );
}

/**
 * Each bar's close over the trailing EPS that was public on its day, so a past multiple never
 * leans on results the market had not seen. Bars are left out before four quarters were public
 * and while the trailing EPS is not a profit.
 */
export function priceToEarnings(
  market: Market,
  bars: readonly Candle[],
  statements: readonly QuarterStatement[]
): { date: string; pe: number }[] {
  const metrics = statementMetrics(statements);

  return bars.flatMap((bar) => {
    const date = candleDate(market, bar.time);

    const eps = metrics.findLast(
      ({ statement }) => statement.knownFrom <= date
    )?.trailingEps;

    return eps === null || eps === undefined || eps <= 0
      ? []
      : [{ date, pe: bar.close / eps }];
  });
}
