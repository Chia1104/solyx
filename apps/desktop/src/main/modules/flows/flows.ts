import { emptyListingFlows, emptyMarketFlows } from "@solyx/core/flows";
import type {
  Flows,
  FlowsProvider,
  ListingFlows,
  MarketFlows,
} from "@solyx/core/flows";
import {
  MARKET_TIME_ZONE,
  exchangeClock,
  exchangeDate,
  shiftDate,
  symbolKey,
} from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import { keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

// Two months hold the month of sessions a figure sums over, and a run of sessions twice as long.
const LOOKBACK_DAYS = 60;

// When FinMind has a Taiwan session's figures in, with half an hour to spare: the market's
// institutions at 15:00, its index future at 18:00, and the rest at 21:00.
const PUBLISHED = ["15:30", "18:30", "21:30"].map((time) =>
  Temporal.PlainTime.from(time)
);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether an answer asked for at `askedAt` still serves at `now`: no session's figures came out between. */
function unpublishedSince(
  market: Market,
  askedAt: number,
  now: number
): boolean {
  if (now - askedAt >= DAY_MS) return false;

  const today = exchangeClock(market, new Date(now)).toPlainDate();

  return [today.subtract({ days: 1 }), today].every((day) =>
    PUBLISHED.every((plainTime) => {
      const out = day.toZonedDateTime({
        timeZone: MARKET_TIME_ZONE[market],
        plainTime,
      }).epochMilliseconds;

      return out <= askedAt || out > now;
    })
  );
}

export interface FlowsOptions {
  /** One per market at most; the first that covers a market answers for it. */
  providers: readonly FlowsProvider[];
  /** Where each listing's and market's answers are kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Who trades each listing and market, from the provider that covers its market, two months back,
 * each answer kept until a session's next figures come out.
 */
export function createFlows({
  providers,
  answers,
  now = () => new Date(),
}: FlowsOptions): Flows {
  const covering = (market: Market) =>
    providers.find(({ markets }) => markets.includes(market));

  const since = (market: Market) =>
    shiftDate(exchangeDate(market, now()), -LOOKBACK_DAYS);

  const listings = keepFresh<
    { symbol: SymbolRef; provider: FlowsProvider },
    ListingFlows
  >({
    store: answers("flows:listing"),
    id: ({ symbol, provider }) => `${provider.id}:${symbolKey(symbol)}`,
    ask: ({ symbol, provider }) =>
      provider.getListingFlows(symbol, since(symbol.market)),
    fresh: ({ symbol }, askedAt, at) =>
      unpublishedSince(symbol.market, askedAt, at),
    now: () => now().getTime(),
  });

  const markets = keepFresh<
    { market: Market; provider: FlowsProvider },
    MarketFlows
  >({
    store: answers("flows:market"),
    id: ({ market, provider }) => `${provider.id}:${market}`,
    ask: ({ market, provider }) =>
      provider.getMarketFlows(market, since(market)),
    fresh: ({ market }, askedAt, at) => unpublishedSince(market, askedAt, at),
    now: () => now().getTime(),
  });

  return {
    listing(symbol) {
      const provider = covering(symbol.market);

      return provider
        ? listings({ symbol, provider })
        : Promise.resolve(emptyListingFlows());
    },

    market(market) {
      const provider = covering(market);

      return provider
        ? markets({ market, provider })
        : Promise.resolve(emptyMarketFlows());
    },
  };
}
