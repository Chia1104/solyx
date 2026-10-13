import type { AppLinks } from "../../src/prompt.ts";

/** A host's addresses, shaped like the desktop's. */
export const LINKS: AppLinks = {
  listing: ({ market, symbol }, interval) =>
    `#/symbol/${market}/${symbol}?interval=${interval}`,
  overview: {
    moves: "#/?tab=today",
    headlines: "#/?tab=news",
    calendar: "#/?tab=calendar",
    market: "#/?tab=market",
  },
};
