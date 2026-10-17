import type { Candle } from "@solyx/core/candles";
import { TW_BOARD_LOT, twTickSize } from "@solyx/core/rules/tw";
import type desktopEnUS from "@solyx/i18n/desktop/en-US.json";

import { roundToTick } from "./listings.ts";
import type { Listing } from "./listings.ts";

/**
 * The demo agent's turns as data: the tools it calls, its levels and what it drafts. The agent pane
 * words them through the catalogs, so this module holds no sentence in any language.
 */

/** A tool call the demo agent shows as done, named by the app's own id for it. */
export interface ToolStep {
  tool: keyof (typeof desktopEnUS)["agent"]["tools"];
  /** Whether it reads the paper account rather than the listing. */
  account: boolean;
}

/** Where a forecast's scenario lies against the listing's support and resistance. */
export const Band = {
  Below: "below",
  Range: "range",
  Above: "above",
} as const;

export type Band = (typeof Band)[keyof typeof Band];

export interface Scenario {
  band: Band;
  low: number | null;
  high: number | null;
  probability: number;
  /** How often the listing's own history landed here over the same horizon. */
  history: number;
}

export interface Forecast {
  sessions: number;
  from: number;
  scenarios: Scenario[];
}

export const Vote = {
  Approves: "approves",
  Rejects: "rejects",
} as const;

export type Vote = (typeof Vote)[keyof typeof Vote];

/** Why a MAGI unit voted as it did, by its key in the website's catalog. */
export const VoteReason = {
  Dip: "dip",
  Paper: "paper",
  Flows: "flows",
} as const;

export type VoteReason = (typeof VoteReason)[keyof typeof VoteReason];

export interface UnitVote {
  unit: string;
  vote: Vote;
  reason: VoteReason;
}

export interface Proposal {
  quantity: number;
  price: number;
  /** The tick the price sits on. */
  tick: number;
  /** The next session's limits, rounded inward to the tick. */
  bandLow: number;
  bandHigh: number;
  votes: UnitVote[];
}

export const Ask = {
  Forecast: "forecast",
  Proposal: "proposal",
} as const;

export type Ask = (typeof Ask)[keyof typeof Ask];

export interface Turn {
  ask: Ask;
  steps: ToolStep[];
  /** The month's low, which the demo reads as support. */
  support: number;
  /** The fortnight's high, which the demo reads as resistance. */
  resistance: number;
  forecast?: Forecast;
  proposal?: Proposal;
}

/** Support and resistance as the demo reads them: the month's low and the fortnight's high. */
function levels(listing: Listing, candles: readonly Candle[]) {
  const month = candles.slice(-20);
  const fortnight = candles.slice(-10);

  return {
    support: roundToTick(
      Math.min(...month.map((bar) => bar.low)),
      listing.code
    ),
    resistance: roundToTick(
      Math.max(...fortnight.map((bar) => bar.high)),
      listing.code
    ),
  };
}

export function turnFor(
  ask: Ask,
  listing: Listing,
  candles: readonly Candle[]
): Turn {
  const { support, resistance } = levels(listing, candles);

  if (ask === Ask.Forecast) {
    return {
      ask,
      support,
      resistance,
      steps: [
        { tool: "get_candles", account: false },
        { tool: "get_flows", account: false },
        { tool: "get_base_rates", account: false },
        { tool: "submit_forecast", account: false },
      ],
      forecast: {
        sessions: 10,
        from: listing.last,
        scenarios: [
          {
            band: Band.Below,
            low: null,
            high: support,
            probability: 0.3,
            history: 0.27,
          },
          {
            band: Band.Range,
            low: support,
            high: resistance,
            probability: 0.5,
            history: 0.46,
          },
          {
            band: Band.Above,
            low: resistance,
            high: null,
            probability: 0.2,
            history: 0.27,
          },
        ],
      },
    };
  }

  // The next session's limits are 10% either side of the last close, rounded inward to the tick.
  const bandLow = roundToTick(listing.last * 0.9, listing.code, Math.ceil);
  const bandHigh = roundToTick(listing.last * 1.1, listing.code, Math.floor);
  const limit = Math.max(support, bandLow);

  return {
    ask,
    support,
    resistance,
    steps: [
      { tool: "get_account", account: true },
      { tool: "get_candles", account: false },
      { tool: "check_order", account: false },
      { tool: "propose_order", account: false },
    ],
    proposal: {
      quantity: TW_BOARD_LOT,
      price: limit,
      tick: twTickSize(limit, listing.code),
      bandLow,
      bandHigh,
      votes: [
        { unit: "MELCHIOR·1", vote: Vote.Approves, reason: VoteReason.Dip },
        { unit: "BALTHASAR·2", vote: Vote.Approves, reason: VoteReason.Paper },
        { unit: "CASPER·3", vote: Vote.Rejects, reason: VoteReason.Flows },
      ],
    },
  };
}
