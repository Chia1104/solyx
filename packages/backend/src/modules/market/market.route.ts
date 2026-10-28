import { sessionBand } from "@solyx/core/risk";

import { contractOS } from "../../rpc/context.ts";

import { marketDirectories, searchListings } from "./listing-search.ts";
import { marketSessions } from "./trading-calendar.ts";

const { market } = contractOS;

export const marketRouter = market.router({
  sessions: market.sessions.handler(({ context }) =>
    marketSessions(context.marketDays)
  ),
  listing: market.listing.handler(({ context, input }) =>
    context.marketData.listing(input)
  ),
  search: market.search.handler(({ context, input }) =>
    searchListings(input, marketDirectories(context))
  ),
  candles: market.candles.handler(
    async ({ context, input: { symbol, interval, before } }) => ({
      symbol,
      interval,
      candles:
        before === undefined
          ? await context.marketData.candles(symbol, interval)
          : await context.marketData.olderCandles(symbol, interval, before),
    })
  ),
  quote: market.quote.handler(({ context, input }) =>
    context.marketData.quote(input)
  ),
  sectors: market.sectors.handler(({ context, input }) =>
    context.marketData.sectors(input.market)
  ),
  rotations: market.rotations.handler(({ context, input }) =>
    context.rotations.sectorHistory(input.benchmark)
  ),
  listingRotations: market.listingRotations.handler(
    ({ context, input: { symbols, ...options } }) =>
      context.rotations.listingHistory(symbols, options)
  ),
  listingRotation: market.listingRotation.handler(({ context, input }) =>
    context.rotations.listing(input)
  ),
  liveCandles: market.liveCandles.handler(({ context, input, signal }) =>
    context.marketData.liveCandles(input.symbol, input.interval, signal)
  ),
  depth: market.depth.handler(({ context, input, signal }) =>
    context.marketData.depth(input, signal)
  ),
  band: market.band.handler(async ({ context, input }) => {
    const [limits, days] = await Promise.all([
      context.fundamentals.priceLimits(input),
      context.marketDays(input.market),
    ]);

    return sessionBand(limits, input.market, new Date(), days) ?? null;
  }),
  sourceChanges: market.sourceChanges.handler(({ context, signal }) =>
    context.windowEvents.subscribe("market:sources-changed", { signal })
  ),
});
