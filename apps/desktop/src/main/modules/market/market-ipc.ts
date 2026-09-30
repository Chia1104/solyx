import * as z from "zod";

import { LOOKBACK_DAYS, intervalSchema } from "@solyx/core/candles";
import {
  Market,
  exchangeDate,
  shiftDate,
  symbolRefSchema,
} from "@solyx/core/market";
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

export function registerMarketIpc({ marketData, liveCandles }: Services) {
  handle("sessions", async () => ({
    [Market.TW]: getSession(Market.TW),
    [Market.US]: getSession(Market.US),
  }));

  handle("listing", async (symbol) => {
    const provider = await marketData.provider(symbol.market);

    return provider ? provider.getListing(symbol) : null;
  });

  handle("candles", async (symbol, interval) => {
    const provider = await marketData.provider(symbol.market);

    if (!provider) {
      throw new Error(
        `No market data for ${symbol.market}: no source covers it or its settings are incomplete`
      );
    }

    const to = exchangeDate(symbol.market);

    return provider.getCandles({
      symbol,
      interval,
      from: shiftDate(to, -LOOKBACK_DAYS[interval]),
      to,
    });
  });

  handle("watchCandles", (symbol, interval, event) =>
    liveCandles.watch(event.sender, symbol, interval)
  );

  handle("unwatchCandles", async (symbol, interval, event) =>
    liveCandles.unwatch(event.sender, symbol, interval)
  );
}
