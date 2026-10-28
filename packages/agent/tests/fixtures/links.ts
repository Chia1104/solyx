import type { AppLinks, AppPlace } from "../../src/prompt.ts";

const TAB: Record<AppPlace, string> = {
  moves: "today",
  headlines: "news",
  calendar: "calendar",
  market: "market",
};

/** A host's addresses, shaped like the desktop's. */
export const LINKS: AppLinks = {
  listing: ({ market, symbol }, interval) =>
    `#/symbol/${market}/${symbol}?interval=${interval}`,
  overview: (place, market) =>
    `#/?tab=${TAB[place]}${market ? `&market=${market}` : ""}`,
  strategy: (name) => `#/strategies/${name}`,
};
