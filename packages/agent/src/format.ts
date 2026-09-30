import { memoize } from "es-toolkit";

import { MARKET_TIME_ZONE } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";

const clockFormatter = memoize(
  (timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
);

/** `YYYY-MM-DD HH:mm` on the exchange's clock, the way the model is told every time. */
export function exchangeTime(market: Market, epochMs: number): string {
  return clockFormatter(MARKET_TIME_ZONE[market])
    .format(epochMs)
    .replace(", ", " ");
}
