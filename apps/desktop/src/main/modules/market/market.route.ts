import { BENCHMARK, Market } from "@solyx/core/market";
import { sessionBand } from "@solyx/core/risk";
import { TW_SECTOR_INDICES, sectorOfIndustry } from "@solyx/core/sectors";

import { contractOS } from "../../rpc/context.ts";

import { marketSessions } from "./trading-calendar.ts";

const { market } = contractOS;

export const marketRouter = market.router({
  sessions: market.sessions.handler(({ context }) =>
    marketSessions(context.marketDays)
  ),
  listing: market.listing.handler(({ context, input }) =>
    context.marketData.listing(input)
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
  sectors: market.sectors.handler(({ context }) =>
    context.marketData.sectors()
  ),
  rotations: market.rotations.handler(({ context }) =>
    context.marketData.rotations()
  ),
  listingRotations: market.listingRotations.handler(({ context, input }) =>
    context.marketData.listingRotations(input)
  ),
  listingRotation: market.listingRotation.handler(
    async ({ context, input }) => {
      const [against] = await context.marketData.listingRotations([input]);

      // Only TWSE's industries have an index, and the exchange's list says which one a company is in.
      const company =
        input.market === Market.TW
          ? await context.fundamentals.company(input)
          : null;

      const sector = company && sectorOfIndustry(company.industry.code);
      const index = TW_SECTOR_INDICES.find((each) => each.sector === sector);

      return {
        index: {
          name: BENCHMARK[input.market].name,
          readings: against.readings,
        },
        sector:
          sector && index
            ? {
                sector,
                symbol: index.symbol,
                readings: await context.marketData.rotationAgainst(input, {
                  market: Market.TW,
                  symbol: index.symbol,
                }),
              }
            : null,
      };
    }
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
