import { meanBy, sumBy } from "es-toolkit";

import { Currency, currencyOf, symbolKey } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import type { TradeProposal } from "./order-desk.ts";
import { Side } from "./order.ts";
import type { Fill, Position } from "./order.ts";
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
 * proposal kept. What the account held before the first fill is worked out from what it holds now
 * less what the fills bought and sold, and a position it held then opens no trip, however it was
 * added to, until it is sold off: its first buy, and so its research, is not among the fills.
 */
export function roundTrips(
  fills: readonly Fill[],
  proposals: readonly TradeProposal[],
  holdings: readonly Position[]
): RoundTrip[] {
  const basisOf = new Map(
    proposals.flatMap((proposal) =>
      proposal.brokerOrderId === undefined
        ? []
        : [[proposal.brokerOrderId, proposal.basis] as const]
    )
  );

  // Each listing's shares, and the trip they belong to; `null` for shares held before the fills began.
  const positions = new Map<string, { held: number; trip: RoundTrip | null }>();

  for (const { instrument, quantity } of holdings) {
    positions.set(symbolKey(instrument), { held: quantity, trip: null });
  }

  for (const { instrument, side, quantity } of fills) {
    const position = positions.get(symbolKey(instrument)) ?? {
      held: 0,
      trip: null,
    };

    position.held += side === Side.Buy ? -quantity : quantity;
    positions.set(symbolKey(instrument), position);
  }

  for (const position of positions.values()) {
    position.held = Math.max(position.held, 0);
  }

  const closed: RoundTrip[] = [];

  for (const fill of fills.toSorted((a, b) => a.filledAt - b.filledAt)) {
    const position = positions.get(symbolKey(fill.instrument)) ?? {
      held: 0,
      trip: null,
    };

    if (fill.side === Side.Buy) {
      if (position.held === 0) {
        position.trip = {
          instrument: fill.instrument,
          openedAt: fill.filledAt,
          closedAt: fill.filledAt,
          realized: 0,
          stance: basisOf.get(fill.orderId)?.report?.stance ?? null,
        };
      }

      position.held += fill.quantity;
    } else {
      position.held -= fill.quantity;

      if (position.trip) position.trip.realized += fill.realized ?? 0;

      if (position.held <= 0) {
        if (position.trip) {
          closed.push({ ...position.trip, closedAt: fill.filledAt });
        }

        position.held = 0;
        position.trip = null;
      }
    }

    positions.set(symbolKey(fill.instrument), position);
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
