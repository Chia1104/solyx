import type {
  MarketDataPlan,
  MarketDataProvider,
  MarketDataStream,
} from "@solyx/core/market-data";

import { createFugleApiProvider, createFugleApiStream } from "./fugle-api.ts";
import type {
  FugleApiAccess,
  FugleApiOptions,
  StreamConnect,
} from "./fugle-api.ts";

/** Fubon's published limits, the same for every account; one connection streams 300 symbols. */
export const FUBON_PLAN = {
  id: "neo",
  streamSymbols: 300,
  requestsPerMinute: { intraday: 300, historical: 60 },
} satisfies MarketDataPlan<"neo">;

/**
 * A signed-in Fubon Neo session's market data token and the endpoints that take it, as
 * `@solyx/brokers/fubon` exchanges them. The stream must be the Normal-mode one, the only
 * mode that serves candles.
 */
export interface FubonRealtime {
  sdkToken: string;
  /** Host and path prefix, as the SDK reports them. */
  restBaseUrl: string;
  streamBaseUrl: string;
}

// Fubon serves Fugle's market data API; its session tokens stand in for a Fugle key.
const fubonAccess = (realtime: FubonRealtime): FugleApiAccess => ({
  id: "fubon",
  restBaseUrl: realtime.restBaseUrl,
  streamBaseUrl: realtime.streamBaseUrl,
  headers: { "X-SDK-TOKEN": realtime.sdkToken },
  auth: { sdkToken: realtime.sdkToken },
  plan: FUBON_PLAN,
});

export interface FubonMarketDataOptions extends FugleApiOptions {
  realtime: FubonRealtime;
}

/** Taiwan listings through the user's Fubon Securities account. */
export function createFubonMarketData(
  options: FubonMarketDataOptions
): MarketDataProvider {
  return createFugleApiProvider(fubonAccess(options.realtime), options);
}

export interface FubonStreamOptions {
  realtime: FubonRealtime;
  /** @default (url) => new WebSocket(url) */
  connect?: StreamConnect;
}

/** Fubon's live 1-minute bars over one connection. */
export function createFubonStream(
  options: FubonStreamOptions
): MarketDataStream {
  return createFugleApiStream(fubonAccess(options.realtime), options.connect);
}
