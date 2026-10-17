import type { Candle } from "@solyx/core/candles";
import { TW_BOARD_LOT, twTickSize } from "@solyx/core/rules/tw";
import { agent } from "@solyx/i18n/desktop/en-US.json";

import { price } from "./format.ts";
import { roundToTick } from "./listings.ts";
import type { Listing } from "./listings.ts";

/** A tool call the demo agent shows as done, labelled from the app's own catalog. */
export interface ToolStep {
  label: string;
  detail: string;
}

export interface Scenario {
  label: string;
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

export interface UnitVote {
  unit: string;
  vote: Vote;
  reason: string;
}

export interface Proposal {
  quantity: number;
  price: number;
  checks: string[];
  votes: UnitVote[];
}

export const Ask = {
  Forecast: "forecast",
  Proposal: "proposal",
} as const;

export type Ask = (typeof Ask)[keyof typeof Ask];

export interface Turn {
  ask: Ask;
  prompt: string;
  steps: ToolStep[];
  reply: string;
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

export function prompts(listing: Listing): Record<Ask, string> {
  return {
    [Ask.Forecast]: `Where could ${listing.code} close in ten sessions?`,
    [Ask.Proposal]: `Draft a buy of one lot of ${listing.code} near support`,
  };
}

export function turnFor(
  ask: Ask,
  listing: Listing,
  candles: readonly Candle[]
): Turn {
  const { support, resistance } = levels(listing, candles);
  const subject = `${listing.code} ${listing.name}`;
  const prompt = prompts(listing)[ask];

  if (ask === Ask.Forecast) {
    return {
      ask,
      prompt,
      steps: [
        { label: agent.tools.get_candles, detail: subject },
        { label: agent.tools.get_flows, detail: subject },
        { label: agent.tools.get_base_rates, detail: subject },
        { label: agent.tools.submit_forecast, detail: subject },
      ],
      reply: `${listing.code} closed at ${price(listing.last)}, between the month's low at ${price(support)} and the fortnight's high at ${price(resistance)}. I put most weight on it staying in that range; history lands there a little less often.`,
      forecast: {
        sessions: 10,
        from: listing.last,
        scenarios: [
          {
            label: `Loses support, below ${price(support)}`,
            low: null,
            high: support,
            probability: 0.3,
            history: 0.27,
          },
          {
            label: "Holds the range",
            low: support,
            high: resistance,
            probability: 0.5,
            history: 0.46,
          },
          {
            label: `Clears ${price(resistance)}`,
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
  const tick = twTickSize(limit, listing.code);

  return {
    ask,
    prompt,
    steps: [
      { label: agent.tools.get_account, detail: "Paper" },
      { label: agent.tools.get_candles, detail: subject },
      { label: agent.tools.check_order, detail: subject },
      { label: agent.tools.propose_order, detail: subject },
    ],
    reply: `${
      limit === support
        ? `I drafted a limit buy at the month's low, ${price(limit)}.`
        : `The month's low, ${price(support)}, is below the next session's limit, so I drafted a limit buy at ${price(limit)}.`
    } It passed the risk checks; MAGI carried it two to one. It waits for you.`,
    proposal: {
      quantity: TW_BOARD_LOT,
      price: limit,
      checks: [
        `One board lot of ${price(TW_BOARD_LOT)} shares`,
        `${price(limit)} is on the ${price(tick)} tick`,
        `Inside the next session's limits, ${price(bandLow)} to ${price(bandHigh)}`,
        `Paper cash covers ${price(limit * TW_BOARD_LOT)} TWD`,
      ],
      votes: [
        {
          unit: "MELCHIOR·1",
          vote: Vote.Approves,
          reason: "A limit below the close fills only on a dip.",
        },
        {
          unit: "BALTHASAR·2",
          vote: Vote.Approves,
          reason: "One lot on paper puts no real money at risk.",
        },
        {
          unit: "CASPER·3",
          vote: Vote.Rejects,
          reason: "Foreign investors sold five sessions running.",
        },
      ],
    },
  };
}
