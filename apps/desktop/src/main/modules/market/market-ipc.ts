import * as z from "zod";

import { intervalSchema } from "@solyx/core/candles";
import { Market, symbolRefSchema } from "@solyx/core/market";
import { getSession } from "@solyx/core/session";

import { marketChannels } from "#shared/ipc/market.ts";
import type { MarketApi } from "#shared/ipc/market.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const handle = ipcModule<MarketApi>(marketChannels, {
  sessions: z.tuple([]),
  listing: z.tuple([symbolRefSchema]),
  candles: z.tuple([symbolRefSchema, intervalSchema]),
  watchCandles: z.tuple([symbolRefSchema, intervalSchema]),
  unwatchCandles: z.tuple([symbolRefSchema, intervalSchema]),
});

export function registerMarketIpc({ marketData }: Services) {
  handle("sessions", async () => ({
    [Market.TW]: getSession(Market.TW),
    [Market.US]: getSession(Market.US),
  }));

  handle("listing", (symbol) => marketData.listing(symbol));

  handle("candles", (symbol, interval) => marketData.candles(symbol, interval));

  handle("watchCandles", (symbol, interval, event) =>
    marketData.watch(event.sender, symbol, interval)
  );

  handle("unwatchCandles", async (symbol, interval, event) =>
    marketData.unwatch(event.sender, symbol, interval)
  );
}
