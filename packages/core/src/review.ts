import { meanBy, sumBy } from "es-toolkit";

import { Currency, currencyOf, symbolKey } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import type { TradeProposal } from "./order-desk.ts";
import { Side } from "./order.ts";
import type { Fill } from "./order.ts";
import { ReportStance } from "./report.ts";

/** A position in one listing from the buy that opened it to the sale that left none. */
export interface RoundTrip {
  instrument: SymbolRef;
  /** UTC milliseconds of its first buy. */
  openedAt: number;
  /** UTC milliseconds of the sale that closed it. */
  closedAt: number;
  /** What its sales gained in all over the average cost, before fees and tax, in the market's currency. */
  realized: number;
  /** The stance of the report its first buy was proposed under; `null` where none was in force. */
  stance: ReportStance | null;
}

/**
 * The round trips the fills close, oldest first, each opened under the research its first buy's
 * proposal kept. A sale with no buy before it among the fills, of shares held before the broker
 * reported fills, opens nothing, so it is left out.
 */
export function roundTrips(
  fills: readonly Fill[],
  proposals: readonly TradeProposal[]
): RoundTrip[] {
  const basisOf = new Map(
    proposals.flatMap((proposal) =>
      proposal.brokerOrderId === undefined
        ? []
        : [[proposal.brokerOrderId, proposal.basis] as const]
    )
  );

  const open = new Map<string, { trip: RoundTrip; held: number }>();
  const closed: RoundTrip[] = [];

  for (const fill of fills.toSorted((a, b) => a.filledAt - b.filledAt)) {
    const key = symbolKey(fill.instrument);
    const position = open.get(key);

    if (fill.side === Side.Buy) {
      if (position) {
        position.held += fill.quantity;
      } else {
        open.set(key, {
          held: fill.quantity,
          trip: {
            instrument: fill.instrument,
            openedAt: fill.filledAt,
            closedAt: fill.filledAt,
            realized: 0,
            stance: basisOf.get(fill.orderId)?.report?.stance ?? null,
          },
        });
      }
    } else if (position) {
      position.held -= fill.quantity;
      position.trip.realized += fill.realized ?? 0;

      if (position.held <= 0) {
        closed.push({ ...position.trip, closedAt: fill.filledAt });
        open.delete(key);
      }
    }
  }

  return closed;
}

/** How a set of round trips went: how many gained, and what the average gain was against the average loss. */
export interface TradeRecord {
  trips: number;
  wins: number;
  losses: number;
  /** `null` with no trips. */
  winRate: number | null;
  /** `null` with no wins. */
  averageWin: number | null;
  /** As a loss below zero; `null` with no losses. */
  averageLoss: number | null;
  /** The average win over the size of the average loss; `null` without both. */
  payoffRatio: number | null;
  realized: number;
}

export function tradeRecord(trips: readonly RoundTrip[]): TradeRecord {
  const wins = trips.filter(({ realized }) => realized > 0);
  const losses = trips.filter(({ realized }) => realized < 0);
  const averageWin = wins.length > 0 ? meanBy(wins, (t) => t.realized) : null;

  const averageLoss =
    losses.length > 0 ? meanBy(losses, (t) => t.realized) : null;

  return {
    trips: trips.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trips.length > 0 ? wins.length / trips.length : null,
    averageWin,
    averageLoss,
    payoffRatio:
      averageWin !== null && averageLoss !== null
        ? averageWin / -averageLoss
        : null,
    realized: sumBy(trips, (t) => t.realized),
  };
}

/** A currency's round trips: all of them, and those opened under each stance, `null` for no report. */
export interface CurrencyRecord {
  currency: Currency;
  all: TradeRecord;
  stances: { stance: ReportStance | null; record: TradeRecord }[];
}

/** The trips' records per currency they were traded in, each stance's only where it opened some. */
export function recordsByStance(trips: readonly RoundTrip[]): CurrencyRecord[] {
  return Object.values(Currency).flatMap((currency) => {
    const theirs = trips.filter(
      ({ instrument }) => currencyOf(instrument.market) === currency
    );

    if (theirs.length === 0) return [];

    const stances = [...Object.values(ReportStance), null].flatMap((stance) => {
      const opened = theirs.filter((trip) => trip.stance === stance);

      return opened.length > 0 ? [{ stance, record: tradeRecord(opened) }] : [];
    });

    return [{ currency, all: tradeRecord(theirs), stances }];
  });
}
