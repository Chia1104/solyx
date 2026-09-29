import * as z from "zod";

import { Market } from "@solyx/core/market";
import { getSession } from "@solyx/core/session";

import { marketChannels } from "#shared/ipc/market.ts";
import type { MarketApi } from "#shared/ipc/market.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";

const handle = ipcModule<MarketApi>(marketChannels, {
  sessions: z.tuple([]),
});

export function registerMarketIpc() {
  handle("sessions", async () => ({
    [Market.TW]: getSession(Market.TW),
    [Market.US]: getSession(Market.US),
  }));
}
