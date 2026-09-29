import type { Market } from "@solyx/core/market";
import type { Session } from "@solyx/core/session";

export interface MarketApi {
  sessions(): Promise<Record<Market, Session>>;
}

export const marketChannels = {
  sessions: "market:sessions",
} as const satisfies Record<keyof MarketApi, string>;
