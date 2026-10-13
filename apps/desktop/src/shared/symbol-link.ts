import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

/** A listing's page in the router's hash, its chart on `interval`, which the agent's replies link to. */
export const symbolLink = ({ market, symbol }: SymbolRef, interval: Interval) =>
  `#/symbol/${market}/${encodeURIComponent(symbol)}?interval=${interval}`;
