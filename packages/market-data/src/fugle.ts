import ky from "ky";
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
import {
  Market,
  exchangeDate,
  exchangeMidnight,
  shiftDate,
} from "@solyx/core/market";
import type {
  CandleRequest,
  MarketDataPlan,
  MarketDataProvider,
  MarketDataStream,
  MinuteListener,
} from "@solyx/core/market-data";
import { TW_BOARD_LOT } from "@solyx/core/rules/tw";
import { createRateLimiter } from "@solyx/utils/rate-limit";

const FUGLE_STOCK_API = "https://api.fugle.tw/marketdata/v1.0/stock/";

export const FuglePlan = {
  Basic: "basic",
  Developer: "developer",
  Advanced: "advanced",
} as const;

export type FuglePlan = (typeof FuglePlan)[keyof typeof FuglePlan];

export const fuglePlanSchema = z.enum(FuglePlan);

/** Fugle's published limits; history allows 60 requests a minute on every plan. */
export const FUGLE_PLANS = {
  [FuglePlan.Basic]: {
    id: FuglePlan.Basic,
    streamSymbols: 5,
    requestsPerMinute: { intraday: 60, historical: 60 },
  },
  [FuglePlan.Developer]: {
    id: FuglePlan.Developer,
    streamSymbols: 300,
    requestsPerMinute: { intraday: 600, historical: 60 },
  },
  [FuglePlan.Advanced]: {
    id: FuglePlan.Advanced,
    streamSymbols: 2000,
    requestsPerMinute: { intraday: 2000, historical: 60 },
  },
} satisfies { [Plan in FuglePlan]: MarketDataPlan<Plan> };

const MINUTE_MS = 60_000;

// A 429 means something else shares the key's budget; retry briefly rather than hang the chart.
const MAX_RETRY_AFTER_MS = 10_000;

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

// Fugle answers 404 both for symbols it does not list and for ranges without a session,
// such as a weekend, so a 404 means no bars for that one request.
const NOT_FOUND_IS_EMPTY = {
  throwHttpErrors: (status: number) => status !== 404,
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

// Minute bars carry an ISO time and count board lots; longer bars carry a date and count shares.
function toCandle(bar: Bar, interval: BarInterval): Candle {
  const intraday = isIntraday(interval);

  return {
    time: intraday
      ? Date.parse(bar.date) / 1000
      : exchangeMidnight(Market.TW, bar.date),
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
  /**
   * The plan the key belongs to, which sets the request budgets.
   * @default FuglePlan.Basic
   */
  plan?: FuglePlan;
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
    retry: { maxRetryAfter: MAX_RETRY_AFTER_MS },
  });

  // Budgets hold only within one provider, so callers keep a single provider per key.
  const { requestsPerMinute } = FUGLE_PLANS[options.plan ?? FuglePlan.Basic];

  const intradayBudget = createRateLimiter({
    limit: requestsPerMinute.intraday,
    windowMs: MINUTE_MS,
  });

  const historyBudget = createRateLimiter({
    limit: requestsPerMinute.historical,
    windowMs: MINUTE_MS,
  });

  const now = options.now ?? (() => new Date());

  async function historical(
    symbol: string,
    interval: BarInterval,
    from: string,
    to: string
  ): Promise<Candle[]> {
    const response = await historyBudget(() =>
      api.get(`historical/candles/${encodeURIComponent(symbol)}`, {
        ...NOT_FOUND_IS_EMPTY,
        searchParams: {
          from,
          to,
          timeframe: TIMEFRAME[interval],
          fields: "open,high,low,close,volume",
          sort: "asc",
        },
      })
    );

    if (response.status === 404) return [];

    return historicalCandlesSchema
      .parse(await response.json())
      .data.map((bar) => toCandle(bar, interval));
  }

  async function today(
    symbol: string,
    interval: BarInterval
  ): Promise<Candle[]> {
    // Today's daily bar is built from the session's hourly bars.
    const timeframe = isIntraday(interval) ? interval : Interval.OneHour;

    const response = await intradayBudget(() =>
      api.get(`intraday/candles/${encodeURIComponent(symbol)}`, {
        ...NOT_FOUND_IS_EMPTY,
        searchParams: { timeframe: TIMEFRAME[timeframe] },
      })
    );

    if (response.status === 404) return [];

    const session = intradayCandlesSchema.parse(await response.json());
    const bars = session.data.map((bar) => toCandle(bar, timeframe));

    if (isIntraday(interval) || bars.length === 0) return bars;

    return [
      {
        ...mergeCandles(bars),
        time: exchangeMidnight(Market.TW, session.date),
      },
    ];
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

    const currentDate = exchangeDate(Market.TW, now());
    const lastClose = shiftDate(currentDate, -1);

    // History never holds today, so a range that starts today costs one intraday request.
    const ranges = splitRange(
      isCalendarInterval(interval) ? periodStart(from, interval) : from,
      to < lastClose ? to : lastClose
    );

    const [history, session] = await Promise.all([
      Promise.all(
        ranges.map(([start, end]) =>
          historical(symbol.symbol, barInterval, start, end)
        )
      ),
      to >= currentDate ? today(symbol.symbol, barInterval) : [],
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

      return loadCandles(request);
    },
  };
}

const FUGLE_STREAMING = "wss://api.fugle.tw/marketdata/v1.0/stock/streaming";

// Fugle sends a heartbeat every 30 seconds, so silence past two of them means the connection is gone.
const SILENCE_LIMIT_MS = 75_000;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

const streamMessageSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("authenticated") }),
  z.object({ event: z.literal("error") }),
  z.object({
    event: z.literal("subscribed"),
    data: z.object({ id: z.string(), symbol: z.string() }),
  }),
  z.object({
    event: z.literal("snapshot"),
    data: z.object({ symbol: z.string(), data: z.array(barSchema) }),
  }),
  z.object({
    event: z.literal("data"),
    data: barSchema.extend({ symbol: z.string() }),
  }),
]);

/** The WebSocket surface the stream uses, so tests can drive it without a server. */
export interface StreamSocket {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "close" | "message",
    listener: (event: { data?: unknown }) => void
  ): void;
}

interface StreamCommandData {
  apikey?: string;
  channel?: string;
  symbol?: string;
  id?: string;
}

export interface FugleStreamOptions {
  apiKey: string;
  /**
   * The plan the key belongs to; each watched symbol takes one of its subscriptions.
   * @default FuglePlan.Basic
   */
  plan?: FuglePlan;
  /** @default (url) => new WebSocket(url) */
  connect?: (url: string) => StreamSocket;
}

/**
 * Fugle's live 1-minute bars over one WebSocket. Subscriptions are kept as the set of watched
 * symbols rather than queued commands, so every (re)connect simply subscribes them all.
 */
export function createFugleStream(
  options: FugleStreamOptions
): MarketDataStream {
  const connect = options.connect ?? ((url) => new WebSocket(url));
  const capacity = FUGLE_PLANS[options.plan ?? FuglePlan.Basic].streamSymbols;
  const listeners = new Map<string, Set<MinuteListener>>();
  const channels = new Map<string, string>();
  let socket: StreamSocket | undefined;
  let authenticated = false;
  // A refused key stays refused, so reconnecting cannot help.
  let refused = false;
  let failures = 0;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;

  const command = (event: string, data: StreamCommandData) =>
    socket?.send(JSON.stringify({ event, data }));

  const subscribe = (symbol: string) =>
    command("subscribe", { channel: "candles", symbol });

  // Detaches the socket first, so late events from it are ignored.
  function drop() {
    const current = socket;

    socket = undefined;
    authenticated = false;
    channels.clear();
    clearTimeout(silence);
    current?.close();
  }

  function scheduleReconnect() {
    if (refused || listeners.size === 0 || reconnect) return;

    const delay =
      RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)];

    failures += 1;
    reconnect = setTimeout(() => {
      reconnect = undefined;
      open();
    }, delay);
  }

  function watchSilence() {
    clearTimeout(silence);
    silence = setTimeout(() => {
      drop();
      scheduleReconnect();
    }, SILENCE_LIMIT_MS);
  }

  function receive(text: string) {
    watchSilence();

    let json;

    try {
      json = JSON.parse(text);
    } catch {
      return;
    }

    // Heartbeats, pongs and other events only prove the connection is alive.
    const parsed = streamMessageSchema.safeParse(json);

    if (!parsed.success) return;

    const message = parsed.data;

    switch (message.event) {
      case "authenticated":
        authenticated = true;
        failures = 0;

        for (const symbol of listeners.keys()) subscribe(symbol);
        break;
      case "error":
        if (!authenticated) {
          refused = true;
          drop();
        }

        break;
      case "subscribed":
        channels.set(message.data.symbol, message.data.id);
        break;
      case "snapshot": {
        const minutes = message.data.data.map((bar) =>
          toCandle(bar, Interval.OneMinute)
        );

        for (const listener of listeners.get(message.data.symbol) ?? []) {
          listener.onSession(minutes);
        }

        break;
      }

      case "data": {
        const minute = toCandle(message.data, Interval.OneMinute);

        for (const listener of listeners.get(message.data.symbol) ?? []) {
          listener.onMinute(minute);
        }

        break;
      }
    }
  }

  function open() {
    const current = connect(FUGLE_STREAMING);

    socket = current;
    watchSilence();

    current.addEventListener("open", () => {
      if (socket === current) command("auth", { apikey: options.apiKey });
    });

    current.addEventListener("message", (event) => {
      if (socket === current) receive(String(event.data));
    });

    current.addEventListener("close", () => {
      if (socket !== current) return;

      drop();
      scheduleReconnect();
    });
  }

  function stopAll() {
    clearTimeout(reconnect);
    reconnect = undefined;
    drop();
  }

  return {
    id: "fugle",
    markets: [Market.TW],

    watchMinutes(symbol, listener) {
      if (symbol.market !== Market.TW) return undefined;

      const code = symbol.symbol;
      let watchers = listeners.get(code);

      if (!watchers) {
        if (listeners.size >= capacity) return undefined;

        watchers = new Set();
        listeners.set(code, watchers);
      }

      watchers.add(listener);

      // Every subscribe is answered with a fresh snapshot, so a new listener starts from the whole session.
      if (authenticated) subscribe(code);
      else if (!socket && !reconnect && !refused) open();

      return () => {
        watchers.delete(listener);

        if (watchers.size > 0) return;

        const id = channels.get(code);

        listeners.delete(code);
        channels.delete(code);

        if (listeners.size === 0) stopAll();
        else if (id !== undefined) command("unsubscribe", { id });
      };
    },

    close() {
      listeners.clear();
      stopAll();
    },
  };
}
