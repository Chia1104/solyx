import { RELEASED_DAYS } from "@solyx/core/calendar";
import type {
  MacroCalendarProvider,
  MacroFiguresProvider,
  MacroRelease,
  MacroSeries,
} from "@solyx/core/macro";
import { exchangeDate, shiftDate } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

// An agency sets its schedule months ahead, so a market's is read twice a day at most.
const SCHEDULE_FRESH_MS = 12 * 60 * 60 * 1000;

// A figure comes out at its release's time of day, so a market's are read once an hour at most.
const SERIES_FRESH_MS = 60 * 60 * 1000;

// Two years and the months a release lags its period, so each of the last thirteen periods has the one a year before it.
const SERIES_MONTHS = 26;

export interface MacroOptions {
  /** The sources of release schedules, one per market at most. */
  calendars: readonly MacroCalendarProvider[];
  /** The sources of the indicators' figures, one per market at most. */
  figures: readonly MacroFiguresProvider[];
  /** Where each market's schedule and figures are kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

interface Ask<Provider> {
  market: Market;
  provider: Provider;
}

/**
 * Each market's schedule of economic releases, from `RELEASED_DAYS` back so those just out stay
 * on it, and its indicators' figures over the last two years, each from the source that covers
 * the market and none for a market no source does.
 */
export function createMacro({
  calendars,
  figures,
  answers,
  now = () => new Date(),
}: MacroOptions) {
  const schedules = keepFresh<Ask<MacroCalendarProvider>, MacroRelease[]>({
    store: answers("macro:schedule"),
    id: ({ market, provider }) => `${provider.id}:${market}`,
    ask: ({ market, provider }) =>
      provider.releases(
        market,
        shiftDate(exchangeDate(market, now()), -RELEASED_DAYS)
      ),
    fresh: freshFor(SCHEDULE_FRESH_MS),
    now: () => now().getTime(),
  });

  const kept = keepFresh<Ask<MacroFiguresProvider>, MacroSeries[]>({
    store: answers("macro:series"),
    id: ({ market, provider }) => `${provider.id}:${market}`,
    ask: ({ market, provider }) =>
      provider.series(
        market,
        Temporal.PlainDate.from(exchangeDate(market, now()))
          .toPlainYearMonth()
          .subtract({ months: SERIES_MONTHS })
          .toString()
      ),
    fresh: freshFor(SERIES_FRESH_MS),
    now: () => now().getTime(),
  });

  return {
    schedule(market: Market): Promise<MacroRelease[]> {
      const provider = calendars.find(({ markets }) =>
        markets.includes(market)
      );

      return provider ? schedules({ market, provider }) : Promise.resolve([]);
    },

    series(market: Market): Promise<MacroSeries[]> {
      const provider = figures.find(({ markets }) => markets.includes(market));

      return provider ? kept({ market, provider }) : Promise.resolve([]);
    },
  };
}

export type Macro = ReturnType<typeof createMacro>;
