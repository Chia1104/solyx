import { exchangeDate } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { listedTradingDays, weekdays } from "@solyx/core/session";
import type { TradingCalendarProvider, TradingDays } from "@solyx/core/session";

export interface TradingCalendarOptions {
  /** One per market at most; the first that covers a market answers for it. */
  providers: readonly TradingCalendarProvider[];
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * The days each market trades, from a year back on, read from the provider that covers it once per
 * exchange day; a market none covers trades every weekday.
 */
export function createTradingCalendar({
  providers,
  now = () => new Date(),
}: TradingCalendarOptions) {
  const kept = new Map<Market, { day: string; days: Promise<TradingDays> }>();

  /** Rejects when its provider fails, and asks again on the next call. */
  return (market: Market): Promise<TradingDays> => {
    const provider = providers.find(({ markets }) => markets.includes(market));

    if (!provider) return Promise.resolve(weekdays);

    const day = exchangeDate(market, now());
    const held = kept.get(market);

    if (held?.day === day) return held.days;

    const since = Temporal.PlainDate.from(day)
      .subtract({ years: 1 })
      .toString();

    const days = provider
      .tradingDays(market, since)
      .then((listed) => listedTradingDays(since, listed));

    kept.set(market, { day, days });

    days.catch(() => {
      if (kept.get(market)?.days === days) kept.delete(market);
    });

    return days;
  };
}

export type TradingCalendar = ReturnType<typeof createTradingCalendar>;
