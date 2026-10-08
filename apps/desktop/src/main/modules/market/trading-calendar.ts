import { exchangeDate } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { listedTradingDays, weekdays } from "@solyx/core/session";
import type { TradingCalendarProvider, TradingDays } from "@solyx/core/session";
import { keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

export interface TradingCalendarOptions {
  /** One per market at most; the first that covers a market answers for it. */
  providers: readonly TradingCalendarProvider[];
  /** Where each market's listed days are kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

/** The days a market's provider listed from `since`, a year back from the exchange day they were read on. */
interface ListedDays {
  since: string;
  listed: string[];
}

interface Ask {
  market: Market;
  provider: TradingCalendarProvider;
}

/**
 * The days each market trades, from a year back on, read from the provider that covers it once per
 * exchange day; a market none covers trades every weekday.
 */
export function createTradingCalendar({
  providers,
  answers,
  now = () => new Date(),
}: TradingCalendarOptions) {
  const listedDays = keepFresh<Ask, ListedDays>({
    store: answers("trading-days"),
    id: ({ market }) => market,
    async ask({ market, provider }) {
      const since = Temporal.PlainDate.from(exchangeDate(market, now()))
        .subtract({ years: 1 })
        .toString();

      return { since, listed: await provider.tradingDays(market, since) };
    },
    fresh: ({ market }, askedAt, at) =>
      exchangeDate(market, new Date(askedAt)) ===
      exchangeDate(market, new Date(at)),
    now: () => now().getTime(),
  });

  /** Rejects when its provider fails, and asks again on the next call. */
  return (market: Market): Promise<TradingDays> => {
    const provider = providers.find(({ markets }) => markets.includes(market));

    if (!provider) return Promise.resolve(weekdays);

    return listedDays({ market, provider }).then(({ since, listed }) =>
      listedTradingDays(since, listed)
    );
  };
}

export type TradingCalendar = ReturnType<typeof createTradingCalendar>;
