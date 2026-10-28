import { Market, exchangeDate } from "@solyx/core/market";
import { getSession, listedTradingDays, weekdays } from "@solyx/core/session";
import type {
  ExchangeDays,
  Session,
  TradingCalendarProvider,
  TradingDays,
} from "@solyx/core/session";
import { keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

import type { Diagnostics } from "../telemetry/diagnostics.ts";

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
  listed: ExchangeDays;
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
    store: answers("exchange-days"),
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

/** The days a market trades, for what must go on while its exchange's days cannot be read. */
export type MarketDays = (market: Market) => Promise<TradingDays>;

/**
 * Each market's trading days, or every weekday while its calendar cannot be read, so a provider
 * out of reach never stops a session being told, an order being checked or the clock's work.
 */
export function createMarketDays({
  tradingDays,
  diagnostics,
}: {
  tradingDays: TradingCalendar;
  diagnostics: Pick<Diagnostics, "recovered">;
}): MarketDays {
  return async (market) => {
    try {
      return await tradingDays(market);
    } catch (error) {
      diagnostics.recovered(error, "market.trading-days", {
        "solyx.market": market,
      });

      return weekdays;
    }
  };
}

/** The session each market is in at `at`, closed all day on a day its exchange does not trade. */
export async function marketSessions(
  days: MarketDays,
  at: Date = new Date()
): Promise<Record<Market, Session>> {
  const [taiwan, us] = await Promise.all([days(Market.TW), days(Market.US)]);

  return {
    [Market.TW]: getSession(Market.TW, at, taiwan),
    [Market.US]: getSession(Market.US, at, us),
  };
}
