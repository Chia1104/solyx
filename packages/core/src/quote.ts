import { candleDate } from "./candles.ts";
import type { Candle } from "./candles.ts";
import type { Market } from "./market.ts";
import { regularHours } from "./session.ts";

/** A listing's newest session at a glance: how its price moved against the close before it. */
export interface SessionQuote {
  /** The session's exchange-local date, `YYYY-MM-DD`. */
  date: string;
  /** UTC seconds at which its regular session opens and closes, the span its line is drawn across. */
  hours: { open: number; close: number };
  /** Each bar's open time and close, oldest first. */
  line: { time: number; close: number }[];
  last: number;
  /** The last close of the session before, or `null` when the bars start with this one. */
  previousClose: number | null;
}

/** The newest session in `candles`, intraday bars in ascending time; `null` when there are none. */
export function sessionQuote(
  market: Market,
  candles: readonly Candle[]
): SessionQuote | null {
  const last = candles.at(-1);

  if (!last) return null;

  const date = candleDate(market, last.time);
  let start = candles.length - 1;

  while (start > 0 && candleDate(market, candles[start - 1].time) === date) {
    start -= 1;
  }

  return {
    date,
    hours: regularHours(market, date),
    line: candles.slice(start).map(({ time, close }) => ({ time, close })),
    last: last.close,
    previousClose: start > 0 ? candles[start - 1].close : null,
  };
}
