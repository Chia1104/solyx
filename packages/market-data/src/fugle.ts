import ky, { isHTTPError } from "ky";
import * as z from "zod";

import {
  Interval,
  isCalendarInterval,
  isIntraday,
  mergeCandles,
  periodStart,
  resampleDaily,
} from "@solyx/core/candles";
import type { CalendarInterval, Candle } from "@solyx/core/candles";
import { Market, exchangeDate, shiftDate } from "@solyx/core/market";
import type {
  CandleRequest,
  MarketDataProvider,
} from "@solyx/core/market-data";
import { TW_BOARD_LOT } from "@solyx/core/rules/tw";

const FUGLE_STOCK_API = "https://api.fugle.tw/marketdata/v1.0/stock/";

// Fugle clips weekly and monthly bars to the requested range, so a range split into requests
// would break a period in two; those bars are merged from daily bars instead.
type BarInterval = Exclude<Interval, CalendarInterval>;

const TIMEFRAME: Record<BarInterval, string> = {
  [Interval.OneMinute]: "1",
  [Interval.FiveMinutes]: "5",
  [Interval.FifteenMinutes]: "15",
  [Interval.ThirtyMinutes]: "30",
  [Interval.OneHour]: "60",
  [Interval.OneDay]: "D",
};

// Fugle rejects historical ranges of a year or more.
const MAX_RANGE_DAYS = 360;

const barSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

type Bar = z.infer<typeof barSchema>;

const historicalCandlesSchema = z.object({ data: z.array(barSchema) });

const intradayCandlesSchema = z.object({
  date: z.string(),
  data: z.array(barSchema),
});

function midnightInTaipei(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`) / 1000;
}

// Minute bars carry an ISO time and count board lots; longer bars carry a date and count shares.
function toCandle(bar: Bar, interval: BarInterval): Candle {
  const intraday = isIntraday(interval);

  return {
    time: intraday ? Date.parse(bar.date) / 1000 : midnightInTaipei(bar.date),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: intraday ? bar.volume * TW_BOARD_LOT : bar.volume,
  };
}

function splitRange(from: string, to: string): [string, string][] {
  const ranges: [string, string][] = [];

  for (let start = from; start <= to;) {
    const limit = shiftDate(start, MAX_RANGE_DAYS - 1);
    const end = limit < to ? limit : to;

    ranges.push([start, end]);
    start = shiftDate(end, 1);
  }

  return ranges;
}

export interface FugleMarketDataOptions {
  apiKey: string;
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
  /** @default () => new Date() */
  now?: () => Date;
}

/** Taiwan stocks and ETFs from Fugle's market data API; bars stop at yesterday's close plus today's session. */
export function createFugleMarketData(
  options: FugleMarketDataOptions
): MarketDataProvider {
  const api = ky.create({
    baseUrl: FUGLE_STOCK_API,
    headers: { "X-API-KEY": options.apiKey },
    fetch: options.fetch,
  });

  const now = options.now ?? (() => new Date());

  async function historical(
    symbol: string,
    interval: BarInterval,
    from: string,
    to: string
  ): Promise<Candle[]> {
    const response = await api
      .get(`historical/candles/${encodeURIComponent(symbol)}`, {
        searchParams: {
          from,
          to,
          timeframe: TIMEFRAME[interval],
          fields: "open,high,low,close,volume",
          sort: "asc",
        },
      })
      .json();

    return historicalCandlesSchema
      .parse(response)
      .data.map((bar) => toCandle(bar, interval));
  }

  async function today(
    symbol: string,
    interval: BarInterval
  ): Promise<Candle[]> {
    // Today's daily bar is built from the session's hourly bars.
    const timeframe = isIntraday(interval) ? interval : Interval.OneHour;

    const response = intradayCandlesSchema.parse(
      await api
        .get(`intraday/candles/${encodeURIComponent(symbol)}`, {
          searchParams: { timeframe: TIMEFRAME[timeframe] },
        })
        .json()
    );

    const bars = response.data.map((bar) => toCandle(bar, timeframe));

    if (isIntraday(interval) || bars.length === 0) return bars;

    return [{ ...mergeCandles(bars), time: midnightInTaipei(response.date) }];
  }

  async function loadCandles({
    symbol,
    interval,
    from,
    to,
  }: CandleRequest): Promise<Candle[]> {
    const barInterval = isCalendarInterval(interval)
      ? Interval.OneDay
      : interval;

    const ranges = splitRange(
      isCalendarInterval(interval) ? periodStart(from, interval) : from,
      to
    );

    const [history, session] = await Promise.all([
      Promise.all(
        ranges.map(([start, end]) =>
          historical(symbol.symbol, barInterval, start, end)
        )
      ),
      to >= exchangeDate(Market.TW, now())
        ? today(symbol.symbol, barInterval)
        : [],
    ]);

    const bars = history.flat();
    const lastTime = bars.at(-1)?.time ?? -Infinity;

    bars.push(...session.filter((bar) => bar.time > lastTime));

    return isCalendarInterval(interval)
      ? resampleDaily(bars, interval, Market.TW)
      : bars;
  }

  return {
    id: "fugle",
    markets: [Market.TW],

    async getCandles(request: CandleRequest) {
      if (request.symbol.market !== Market.TW) {
        throw new Error(
          `Fugle has no data for ${request.symbol.market} listings`
        );
      }

      try {
        return await loadCandles(request);
      } catch (error) {
        // Fugle answers 404 for symbols it does not list.
        if (isHTTPError(error) && error.response.status === 404) return [];

        throw error;
      }
    },
  };
}
