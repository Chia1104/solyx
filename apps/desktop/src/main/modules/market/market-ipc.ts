import * as z from "zod";

import { intervalSchema } from "@solyx/core/candles";
import { Market, symbolRefSchema } from "@solyx/core/market";
import { getSession } from "@solyx/core/session";

import { marketChannels } from "#shared/ipc/market.ts";
import type { MarketApi } from "#shared/ipc/market.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  sessions: z.tuple([]),
  listing: z.tuple([symbolRefSchema]),
  candles: z.tuple([symbolRefSchema, intervalSchema]),
  watchCandles: z.tuple([symbolRefSchema, intervalSchema]),
  unwatchCandles: z.tuple([symbolRefSchema, intervalSchema]),
};

export function registerMarketIpc({ marketData }: Services) {
  bindIpc<MarketApi>(marketChannels, schemas, {
    sessions: async () => ({
      [Market.TW]: getSession(Market.TW),
      [Market.US]: getSession(Market.US),
    }),
    listing: (symbol) => marketData.listing(symbol),
    candles: (symbol, interval) => marketData.candles(symbol, interval),
    watchCandles: (symbol, interval, event) =>
      marketData.watch(event.sender, symbol, interval),
    unwatchCandles: async (symbol, interval, event) =>
      marketData.unwatch(event.sender, symbol, interval),
  });
}
