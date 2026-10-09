import { groupBy, sumBy, takeRight, uniq } from "es-toolkit";

import type { Market, SymbolRef } from "./market.ts";

/** The groups of investors whose trading an exchange reports each session. */
export const Investor = {
  /** Foreign and mainland investors, their dealers included. */
  Foreign: "foreign",
  /** Securities investment trusts: the domestic funds. */
  InvestmentTrust: "investment-trust",
  /** Securities dealers trading on their own account. */
  Dealer: "dealer",
  /** Securities dealers hedging the warrants they issued, which follows the warrants' holders rather than a view. */
  DealerHedging: "dealer-hedging",
} as const;

export type Investor = (typeof Investor)[keyof typeof Investor];

/** What one group bought and sold in a session: shares of a listing, or the market's currency for the whole market. */
export interface InvestorTrades {
  /** The session, `YYYY-MM-DD`. */
  date: string;
  investor: Investor;
  bought: number;
  sold: number;
}

/** A listing's margin accounts at a session's close, in shares. */
export interface MarginBalance {
  date: string;
  /** Bought on margin and still held. */
  margin: number;
  /** The most the exchange lets be bought on margin. */
  marginLimit: number;
  /** Sold short on margin and not yet bought back. */
  short: number;
}

/** What foreign investors hold of a listing at a session's close, each as a share of the shares issued. */
export interface ForeignHolding {
  date: string;
  ratio: number;
  /** The most they may hold. */
  limit: number;
}

/** A listing's flows over recent sessions, each list oldest first. */
export interface ListingFlows {
  trades: InvestorTrades[];
  margin: MarginBalance[];
  foreign: ForeignHolding[];
}

/** The whole market's margin accounts at a session's close. */
export interface MarketMargin {
  date: string;
  /** Lent to buy on margin, in the market's currency. */
  marginValue: number;
  /** Shares bought on margin and still held. */
  margin: number;
  /** Shares sold short on margin and not yet bought back. */
  short: number;
}

/** The contracts of the market's index future a group holds open at a session's close. */
export interface FuturesPosition {
  date: string;
  investor: Investor;
  long: number;
  short: number;
}

/** The whole market's flows over recent sessions, each list oldest first; trades are in the market's currency. */
export interface MarketFlows {
  trades: InvestorTrades[];
  margin: MarketMargin[];
  futures: FuturesPosition[];
}

/** One implementation per provider; it runs only in the main process. */
export interface FlowsProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** A listing's flows over the sessions from `since` (`YYYY-MM-DD`) on; empty where its market reports none. */
  getListingFlows(symbol: SymbolRef, since: string): Promise<ListingFlows>;
  getMarketFlows(market: Market, since: string): Promise<MarketFlows>;
}

/** Flows from whichever provider covers the market; empty while none does. */
export interface Flows {
  listing(symbol: SymbolRef): Promise<ListingFlows>;
  market(market: Market): Promise<MarketFlows>;
}

export const emptyListingFlows = (): ListingFlows => ({
  trades: [],
  margin: [],
  foreign: [],
});

export const emptyMarketFlows = (): MarketFlows => ({
  trades: [],
  margin: [],
  futures: [],
});

/** Sessions a week of figures sums over. */
export const WEEK_SESSIONS = 5;

/** Sessions a month of figures sums over. */
export const MONTH_SESSIONS = 20;

/** A group's net buying, bought less sold, back from the newest session. */
export interface NetBuying {
  investor: Investor;
  session: number;
  /** Over the newest week of sessions, or as many as are known. */
  week: number;
  /** Over the newest month of sessions, or as many as are known. */
  month: number;
  /** Sessions in a row, back from the newest, on the newest's side: above zero bought, below sold, zero flat. */
  streak: number;
}

/** Each group's net buying over the sessions any group traded in, the groups in `Investor`'s order. */
export function netBuying(trades: readonly InvestorTrades[]): NetBuying[] {
  const sessions = uniq(trades.map(({ date }) => date)).toSorted();
  const byInvestor = groupBy(trades, ({ investor }) => investor);

  return Object.values(Investor).flatMap((investor) => {
    const own = byInvestor[investor];

    if (!own) return [];

    const nets = groupBy(own, ({ date }) => date);

    const daily = sessions.map((date) =>
      sumBy(nets[date] ?? [], ({ bought, sold }) => bought - sold)
    );

    const over = (count: number) =>
      sumBy(takeRight(daily, count), (net) => net);

    const side = Math.sign(daily.at(-1) ?? 0);
    const run = daily.toReversed().findIndex((net) => Math.sign(net) !== side);

    return [
      {
        investor,
        session: over(1),
        week: over(WEEK_SESSIONS),
        month: over(MONTH_SESSIONS),
        streak: side === 0 ? 0 : side * (run === -1 ? daily.length : run),
      },
    ];
  });
}

/** A balance at the newest session, and how far it moved since a session, a week and a month of sessions before. */
export interface BalanceTrend {
  date: string;
  value: number;
  /** `null` where the series does not reach that far back. */
  session: number | null;
  week: number | null;
  month: number | null;
}

/** The trend of a series of balances, oldest first; `null` for none. */
export function balanceTrend(
  series: readonly { date: string; value: number }[]
): BalanceTrend | null {
  const newest = series.at(-1);

  if (!newest) return null;

  const since = (sessions: number) => {
    const before = series.at(-1 - sessions);

    return before === undefined ? null : newest.value - before.value;
  };

  return {
    date: newest.date,
    value: newest.value,
    session: since(1),
    week: since(WEEK_SESSIONS),
    month: since(MONTH_SESSIONS),
  };
}

/**
 * Rows grouped under the bars they fall in, each bar dated by its first session (`YYYY-MM-DD`,
 * oldest first) and holding the sessions until the next bar's; `null` for a bar that holds none or
 * began before the first row, so a week or month the rows only partly cover reads as unknown.
 */
function byBar<Row extends { date: string }>(
  rows: readonly Row[],
  bars: readonly string[]
): (Row[] | null)[] {
  const first = rows[0]?.date;
  let at = 0;

  return bars.map((date, index) => {
    const next = bars[index + 1];

    while (at < rows.length && rows[at].date < date) at++;

    const start = at;

    while (at < rows.length && (next === undefined || rows[at].date < next)) {
      at++;
    }

    return first === undefined || date < first || at === start
      ? null
      : rows.slice(start, at);
  });
}

/** One group's net buying over each bar's sessions, one value per bar. */
export function netBuyingByBar(
  trades: readonly InvestorTrades[],
  investor: Investor,
  bars: readonly string[]
): (number | null)[] {
  return byBar(
    trades.filter((trade) => trade.investor === investor),
    bars
  ).map(
    (sessions) =>
      sessions && sumBy(sessions, ({ bought, sold }) => bought - sold)
  );
}

/** A balance at the last session of each bar, one value per bar. */
export function balanceByBar(
  series: readonly { date: string; value: number }[],
  bars: readonly string[]
): (number | null)[] {
  return byBar(series, bars).map((sessions) => sessions?.at(-1)?.value ?? null);
}
