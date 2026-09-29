import * as z from "zod";

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

export const FuglePlan = {
  Basic: "basic",
  Developer: "developer",
  Advanced: "advanced",
} as const;

export type FuglePlan = (typeof FuglePlan)[keyof typeof FuglePlan];

export const fuglePlanSchema = z.enum(FuglePlan);

/** Fugle's published limits; history allows 60 requests a minute on every plan. */
export const FUGLE_PLANS = {
  [FuglePlan.Basic]: {
    id: FuglePlan.Basic,
    streamSymbols: 5,
    requestsPerMinute: { intraday: 60, historical: 60 },
  },
  [FuglePlan.Developer]: {
    id: FuglePlan.Developer,
    streamSymbols: 300,
    requestsPerMinute: { intraday: 600, historical: 60 },
  },
  [FuglePlan.Advanced]: {
    id: FuglePlan.Advanced,
    streamSymbols: 2000,
    requestsPerMinute: { intraday: 2000, historical: 60 },
  },
} satisfies { [Plan in FuglePlan]: MarketDataPlan<Plan> };

interface FugleKey {
  apiKey: string;
  /**
   * The plan the key belongs to, which sets the request budgets and how many symbols stream.
   * @default FuglePlan.Basic
   */
  plan?: FuglePlan;
}

const fugleAccess = ({ apiKey, plan }: FugleKey): FugleApiAccess => ({
  id: "fugle",
  restBaseUrl: "https://api.fugle.tw/marketdata",
  streamBaseUrl: "wss://api.fugle.tw/marketdata",
  headers: { "X-API-KEY": apiKey },
  auth: { apikey: apiKey },
  plan: FUGLE_PLANS[plan ?? FuglePlan.Basic],
});

export interface FugleMarketDataOptions extends FugleKey, FugleApiOptions {}

/** Taiwan listings from Fugle with the user's own key. */
export function createFugleMarketData(
  options: FugleMarketDataOptions
): MarketDataProvider {
  return createFugleApiProvider(fugleAccess(options), options);
}

export interface FugleStreamOptions extends FugleKey {
  /** @default (url) => new WebSocket(url) */
  connect?: StreamConnect;
}

/** Fugle's live 1-minute bars; each watched symbol takes one of the plan's subscriptions. */
export function createFugleStream(
  options: FugleStreamOptions
): MarketDataStream {
  return createFugleApiStream(fugleAccess(options), options.connect);
}
