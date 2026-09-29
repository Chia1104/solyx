import * as z from "zod";

import { Interval, intervalSchema } from "@solyx/core/candles";
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

// Enough bars for the slowest indicator to warm up, within Fugle's free-tier rate limit.
const LOOKBACK_DAYS: Record<Interval, number> = {
  [Interval.OneMinute]: 5,
  [Interval.FiveMinutes]: 30,
  [Interval.FifteenMinutes]: 60,
  [Interval.ThirtyMinutes]: 120,
  [Interval.OneHour]: 180,
  [Interval.OneDay]: 540,
  [Interval.OneWeek]: 3 * 365,
  [Interval.OneMonth]: 5 * 365,
};

const handle = ipcModule<MarketApi>(marketChannels, {
  sessions: z.tuple([]),
  candles: z.tuple([symbolRefSchema, intervalSchema]),
});

export function registerMarketIpc({ marketData }: Services) {
  handle("sessions", async () => ({
    [Market.TW]: getSession(Market.TW),
    [Market.US]: getSession(Market.US),
  }));

  handle("candles", async (symbol, interval) => {
    if (!marketData?.markets.includes(symbol.market)) {
      throw new Error(`No market data provider covers ${symbol.market}`);
    }

    const to = exchangeDate(symbol.market);

    return marketData.getCandles({
      symbol,
      interval,
      from: shiftDate(to, -LOOKBACK_DAYS[interval]),
      to,
    });
  });
}
