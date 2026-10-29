import { RELEASED_DAYS } from "@solyx/core/calendar";
import type {
  ExchangeRate,
  ExchangeRateProvider,
} from "@solyx/core/exchange-rate";
import type {
  MacroCalendarProvider,
  MacroFiguresProvider,
  MacroRelease,
  MacroSeries,
} from "@solyx/core/macro";
import { Market, exchangeDate } from "@solyx/core/market";
import type { YieldCurve, YieldCurveProvider } from "@solyx/core/yields";
import { shiftDate, HOUR_MS } from "@solyx/utils/date";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

// An agency sets its schedule months ahead, so a market's is read twice a day at most.
const SCHEDULE_FRESH_MS = 12 * HOUR_MS;

// A figure comes out at its release's time of day, so a market's are read once an hour at most.
const SERIES_FRESH_MS = HOUR_MS;

// A rate closes once a business day, and what it is read for takes one from the day before.
const RATE_FRESH_MS = 3 * HOUR_MS;

// The Treasury puts out a day's curve once after the close.
const YIELDS_FRESH_MS = HOUR_MS;

// About three months of sessions, which a curve's moves are read over.
const YIELD_DAYS = 92;

// Two years and the months a release lags its period, so each of the last thirteen periods has the one a year before it.
const SERIES_MONTHS = 26;

export interface MacroOptions {
  /** The sources of release schedules, one per market at most. */
  calendars: readonly MacroCalendarProvider[];
  /** The sources of the indicators' figures, one per market at most. */
  figures: readonly MacroFiguresProvider[];
  /** The source of the US dollar's rate in Taiwan dollars. */
  exchangeRates: ExchangeRateProvider;
  /** The source of US Treasury debt's daily yield curve. */
  yieldCurves: YieldCurveProvider;
  /** Where each market's schedule and figures, and the rate, are kept between runs. */
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
 * the market and none for a market no source does, the newest rate between the app's two
 * currencies, and US Treasury debt's yield curve over the last few months.
 */
export function createMacro({
  calendars,
  figures,
  exchangeRates,
  yieldCurves,
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

  const rate = keepFresh<ExchangeRateProvider, ExchangeRate>({
    store: answers("macro:exchange-rate"),
    id: ({ id }) => id,
    ask: (provider) => provider.latest(),
    fresh: freshFor(RATE_FRESH_MS),
    // A rate carries its day, so the last one read still reads for what it is.
    keepOnFailure: true,
    now: () => now().getTime(),
  });

  const curves = keepFresh<YieldCurveProvider, YieldCurve[]>({
    store: answers("macro:yields"),
    id: ({ id }) => id,
    ask: (provider) =>
      provider.curves(shiftDate(exchangeDate(Market.US, now()), -YIELD_DAYS)),
    fresh: freshFor(YIELDS_FRESH_MS),
    // Each curve carries its day, so the last ones read still read for what they are.
    keepOnFailure: true,
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

    exchangeRate(): Promise<ExchangeRate> {
      return rate(exchangeRates);
    },

    /** US Treasury debt's yield curve at each of about the last three months' closes, oldest first. */
    yields(): Promise<YieldCurve[]> {
      return curves(yieldCurves);
    },
  };
}

export type Macro = ReturnType<typeof createMacro>;
