import { round } from "es-toolkit";
import ky from "ky";
import * as z from "zod";

import { Interval, isIntraday, mergeCandles } from "@solyx/core/candles";
import type { BarInterval, Candle } from "@solyx/core/candles";
import { Market, exchangeDate, exchangeMidnight } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type {
  CandleRequest,
  Depth,
  Listing,
  Quote,
  MarketDataPlan,
  MarketDataProvider,
  MarketDataStream,
  MinuteListener,
} from "@solyx/core/market-data";
import { TW_BOARD_LOT } from "@solyx/core/rules/tw";
import { shiftDate, MINUTE_MS } from "@solyx/utils/date";
import { parseJson } from "@solyx/utils/json";
import { createRateLimiter } from "@solyx/utils/rate-limit";

const API_VERSION = "v1.0";

/**
 * Where Fugle's market data API is served and what authenticates with it: Fugle's own keys, or
 * a broker such as Fubon that serves the same API under its own session tokens.
 */
export interface FugleApiAccess {
  /** The provider's `id`, which also keeps its cached bars apart. */
  id: string;
  /** Host and path prefix; the API version and product are appended. */
  restBaseUrl: string;
  streamBaseUrl: string;
  /** Headers that authenticate a REST request. */
  headers: Record<string, string>;
  /** The payload of the stream's `auth` event. */
  auth: Record<string, string>;
  /** The plan the credentials belong to, which sets the request budgets and stream capacity. */
  plan: MarketDataPlan;
}

export interface FugleApiOptions {
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
  /** @default () => new Date() */
  now?: () => Date;
}

// A 429 means something else shares the key's budget; retry briefly rather than hang the chart.
const MAX_RETRY_AFTER_MS = 10_000;

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

// More than any price on the exchanges has.
const PRICE_DECIMALS = 4;

// Fugle rejects historical ranges of a year or more.
const MAX_RANGE_DAYS = 360;

const barSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  /**
   * The close less the exchange's reference price; daily bars only. Fugle sends `null` for the odd
   * session, even an ex-dividend one, which then carries no reference.
   */
  change: z
    .number()
    .nullish()
    .transform((change) => change ?? undefined),
});

type Bar = z.infer<typeof barSchema>;

const historicalCandlesSchema = z.object({ data: z.array(barSchema) });

const tickerSchema = z.object({
  name: z.string(),
  nameEn: z.string().optional(),
});

const levelSchema = z.object({ price: z.number(), size: z.number() });

// A session so far, as both the REST quote and the stream's aggregates serve it. Indices report no
// reference price and keep no book, nothing traded has no prices yet, and sizes count board lots.
const quoteSchema = z.object({
  date: z.string(),
  openPrice: z.number().optional(),
  highPrice: z.number().optional(),
  lowPrice: z.number().optional(),
  closePrice: z.number().optional(),
  avgPrice: z.number().optional(),
  referencePrice: z.number().optional(),
  previousClose: z.number().optional(),
  bids: z.array(levelSchema).optional(),
  asks: z.array(levelSchema).optional(),
  total: z
    .object({
      tradeValue: z.number(),
      tradeVolume: z.number().optional(),
      tradeVolumeAtBid: z.number().optional(),
      tradeVolumeAtAsk: z.number().optional(),
    })
    .optional(),
  isTrial: z.boolean().optional(),
  /** UTC microseconds. */
  lastUpdated: z.number().optional(),
});

type FugleQuote = z.infer<typeof quoteSchema>;

const toLevel = ({ price, size }: z.infer<typeof levelSchema>) => ({
  price,
  shares: size * TW_BOARD_LOT,
});

function toDepth(quote: FugleQuote): Depth | null {
  const reference = quote.referencePrice ?? quote.previousClose;

  if (
    reference === undefined ||
    !quote.bids ||
    !quote.asks ||
    quote.lastUpdated === undefined
  ) {
    return null;
  }

  return {
    date: quote.date,
    time: Math.floor(quote.lastUpdated / 1000),
    reference,
    open: quote.openPrice ?? null,
    high: quote.highPrice ?? null,
    low: quote.lowPrice ?? null,
    last: quote.closePrice ?? null,
    average: quote.avgPrice ?? null,
    volume: (quote.total?.tradeVolume ?? 0) * TW_BOARD_LOT,
    volumeAtBid: (quote.total?.tradeVolumeAtBid ?? 0) * TW_BOARD_LOT,
    volumeAtAsk: (quote.total?.tradeVolumeAtAsk ?? 0) * TW_BOARD_LOT,
    bids: quote.bids.map(toLevel),
    asks: quote.asks.map(toLevel),
    trial: quote.isTrial ?? false,
  };
}

const intradayCandlesSchema = z.object({
  date: z.string(),
  data: z.array(barSchema),
});

// Minute bars carry an ISO time and count board lots; longer bars carry a date and count shares.
function toCandle(bar: Bar, interval: BarInterval): Candle {
  const intraday = isIntraday(interval);

  const candle = {
    time: intraday
      ? Date.parse(bar.date) / 1000
      : exchangeMidnight(Market.TW, bar.date),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: intraday ? bar.volume * TW_BOARD_LOT : bar.volume,
  };

  // Rounded back to the exchange's decimals, so a session with nothing gone ex reads its reference
  // as exactly the close before.
  return bar.change === undefined
    ? candle
    : { ...candle, reference: round(bar.close - bar.change, PRICE_DECIMALS) };
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

/** Taiwan stocks and ETFs from Fugle's market data API; bars stop at yesterday's close plus today's session. */
export function createFugleApiProvider(
  access: FugleApiAccess,
  options: FugleApiOptions = {}
): MarketDataProvider {
  const api = ky.create({
    baseUrl: `${access.restBaseUrl}/${API_VERSION}/stock/`,
    headers: access.headers,
    fetch: options.fetch,
    retry: { maxRetryAfter: MAX_RETRY_AFTER_MS },
  });

  // Budgets hold only within one provider, so callers keep a single provider per credential.
  const intradayBudget = createRateLimiter({
    limit: access.plan.requestsPerMinute.intraday,
    windowMs: MINUTE_MS,
  });

  const historyBudget = createRateLimiter({
    limit: access.plan.requestsPerMinute.historical,
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
          // Fugle serves the change, and so the reference, on daily bars alone.
          fields: isIntraday(interval)
            ? "open,high,low,close,volume"
            : "open,high,low,close,volume,change",
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

  function assertTaiwan(symbol: SymbolRef) {
    if (symbol.market !== Market.TW) {
      throw new Error(`${access.id} has no data for ${symbol.market} listings`);
    }
  }

  async function intradayQuote(symbol: SymbolRef): Promise<FugleQuote | null> {
    assertTaiwan(symbol);

    const response = await intradayBudget(() =>
      api.get(
        `intraday/quote/${encodeURIComponent(symbol.symbol)}`,
        NOT_FOUND_IS_EMPTY
      )
    );

    if (response.status === 404) return null;

    return quoteSchema.parse(await response.json());
  }

  return {
    id: access.id,
    markets: [Market.TW],

    async getCandles({
      symbol,
      interval,
      from,
      to,
    }: CandleRequest): Promise<Candle[]> {
      assertTaiwan(symbol);

      const currentDate = exchangeDate(Market.TW, now());
      const lastClose = shiftDate(currentDate, -1);

      // History never holds today, so a range that starts today costs one intraday request.
      const ranges = splitRange(from, to < lastClose ? to : lastClose);

      const [history, session] = await Promise.all([
        Promise.all(
          ranges.map(([start, end]) =>
            historical(symbol.symbol, interval, start, end)
          )
        ),
        to >= currentDate ? today(symbol.symbol, interval) : [],
      ]);

      const bars = history.flat();
      const lastTime = bars.at(-1)?.time ?? -Infinity;

      bars.push(...session.filter((bar) => bar.time > lastTime));

      return bars;
    },

    async getListing(symbol: SymbolRef): Promise<Listing | null> {
      assertTaiwan(symbol);

      const response = await intradayBudget(() =>
        api.get(
          `intraday/ticker/${encodeURIComponent(symbol.symbol)}`,
          NOT_FOUND_IS_EMPTY
        )
      );

      if (response.status === 404) return null;

      const ticker = tickerSchema.parse(await response.json());

      return { name: ticker.name, englishName: ticker.nameEn ?? null };
    },

    async getQuote(symbol: SymbolRef): Promise<Quote | null> {
      const quote = await intradayQuote(symbol);

      if (!quote) return null;

      const reference = quote.referencePrice ?? quote.previousClose;

      if (quote.closePrice === undefined || reference === undefined) {
        return null;
      }

      return {
        date: quote.date,
        last: quote.closePrice,
        reference,
        tradeValue: quote.total?.tradeValue ?? 0,
      };
    },

    async getDepth(symbol: SymbolRef): Promise<Depth | null> {
      const quote = await intradayQuote(symbol);

      return quote ? toDepth(quote) : null;
    },
  };
}

// Fugle sends a heartbeat every 30 seconds, so silence past two of them means the connection is gone.
const SILENCE_LIMIT_MS = 75_000;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

const StreamChannel = {
  Candles: "candles",
  Aggregates: "aggregates",
} as const;

type StreamChannel = (typeof StreamChannel)[keyof typeof StreamChannel];

const streamMessageSchema = z.union([
  z.object({ event: z.literal("authenticated") }),
  z.object({ event: z.literal("error") }),
  z.object({
    event: z.literal("subscribed"),
    data: z.object({ id: z.string(), channel: z.string(), symbol: z.string() }),
  }),
  z.object({
    event: z.literal("snapshot"),
    channel: z.literal(StreamChannel.Candles),
    data: z.object({ symbol: z.string(), data: z.array(barSchema) }),
  }),
  z.object({
    event: z.literal("data"),
    channel: z.literal(StreamChannel.Candles),
    data: barSchema.extend({ symbol: z.string() }),
  }),
  z.object({
    event: z.enum(["snapshot", "data"]),
    channel: z.literal(StreamChannel.Aggregates),
    data: quoteSchema.extend({ symbol: z.string() }),
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

/** Opens a socket to `url`; tests stand in for the server here. */
export type StreamConnect = (url: string) => StreamSocket;

const subscriptionKey = (channel: string, symbol: string) =>
  `${channel}:${symbol}`;

/**
 * Live 1-minute bars and depth over one WebSocket. Subscriptions are kept as the sets of watched
 * symbols rather than queued commands, so every (re)connect simply subscribes them all.
 */
export function createFugleApiStream(
  access: FugleApiAccess,
  connect: StreamConnect = (url) => new WebSocket(url)
): MarketDataStream {
  const url = `${access.streamBaseUrl}/${API_VERSION}/stock/streaming`;
  const minutes = new Map<string, Set<MinuteListener>>();
  const depths = new Map<string, Set<(depth: Depth) => void>>();
  // Fugle's id of each subscription, by channel and symbol.
  const ids = new Map<string, string>();
  let socket: StreamSocket | undefined;
  let authenticated = false;
  // Refused credentials stay refused, so reconnecting cannot help.
  let refused = false;
  let failures = 0;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;

  const subscriptions = () => minutes.size + depths.size;

  const command = (event: string, data: Record<string, string>) =>
    socket?.send(JSON.stringify({ event, data }));

  const subscribe = (channel: StreamChannel, symbol: string) =>
    command("subscribe", { channel, symbol });

  // Detaches the socket first, so late events from it are ignored.
  function drop() {
    const current = socket;

    socket = undefined;
    authenticated = false;
    ids.clear();
    clearTimeout(silence);
    current?.close();
  }

  function scheduleReconnect() {
    if (refused || subscriptions() === 0 || reconnect) return;

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

    const message = parseJson(text, streamMessageSchema);

    // Heartbeats, pongs and other events only prove the connection is alive.
    if (message === undefined) return;

    switch (message.event) {
      case "authenticated":
        authenticated = true;
        failures = 0;

        for (const symbol of minutes.keys()) {
          subscribe(StreamChannel.Candles, symbol);
        }

        for (const symbol of depths.keys()) {
          subscribe(StreamChannel.Aggregates, symbol);
        }

        break;
      case "error":
        if (!authenticated) {
          refused = true;
          drop();
        }

        break;
      case "subscribed":
        ids.set(
          subscriptionKey(message.data.channel, message.data.symbol),
          message.data.id
        );
        break;
      default:
        deliver(message);
    }
  }

  function deliver(
    message: Extract<
      z.infer<typeof streamMessageSchema>,
      { event: "snapshot" | "data" }
    >
  ) {
    if (message.channel === StreamChannel.Aggregates) {
      const depth = toDepth(message.data);

      if (!depth) return;

      for (const listener of depths.get(message.data.symbol) ?? []) {
        listener(depth);
      }

      return;
    }

    if (message.event === "snapshot") {
      const session = message.data.data.map((bar) =>
        toCandle(bar, Interval.OneMinute)
      );

      for (const listener of minutes.get(message.data.symbol) ?? []) {
        listener.onSession(session);
      }

      return;
    }

    const minute = toCandle(message.data, Interval.OneMinute);

    for (const listener of minutes.get(message.data.symbol) ?? []) {
      listener.onMinute(minute);
    }
  }

  function open() {
    const current = connect(url);

    socket = current;
    watchSilence();

    current.addEventListener("open", () => {
      if (socket === current) command("auth", access.auth);
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

  function watch<Listener>(
    channel: StreamChannel,
    listeners: Map<string, Set<Listener>>,
    symbol: SymbolRef,
    listener: Listener
  ) {
    if (symbol.market !== Market.TW) return undefined;

    const code = symbol.symbol;
    const known = listeners.get(code);

    if (!known && subscriptions() >= access.plan.streamSubscriptions) {
      return undefined;
    }

    const watchers = known ?? new Set<Listener>();

    listeners.set(code, watchers);
    watchers.add(listener);

    // Bars answer every subscribe with the session so far, so a new listener starts from it; depth
    // keeps nothing to replay, so its symbol is subscribed once.
    if (authenticated && (!known || channel === StreamChannel.Candles)) {
      subscribe(channel, code);
    } else if (!socket && !reconnect && !refused) {
      open();
    }

    return () => {
      watchers.delete(listener);

      if (watchers.size > 0) return;

      const key = subscriptionKey(channel, code);
      const id = ids.get(key);

      listeners.delete(code);
      ids.delete(key);

      if (subscriptions() === 0) stopAll();
      else if (id !== undefined) command("unsubscribe", { id });
    };
  }

  return {
    id: access.id,
    markets: [Market.TW],

    watchMinutes: (symbol, listener) =>
      watch(StreamChannel.Candles, minutes, symbol, listener),

    watchDepth: (symbol, listener) =>
      watch(StreamChannel.Aggregates, depths, symbol, listener),

    close() {
      minutes.clear();
      depths.clear();
      stopAll();
    },
  };
}
