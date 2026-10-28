import { limitAsync, noop } from "es-toolkit";
import ky from "ky";
import * as z from "zod";

import { Interval, candleDate } from "@solyx/core/candles";
import type { BarInterval, Candle } from "@solyx/core/candles";
import { Market, exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type {
  CandleRequest,
  Depth,
  Listing,
  MarketDataProvider,
  Quote,
} from "@solyx/core/market-data";
import type {
  ExchangeDays,
  TradingCalendarProvider,
} from "@solyx/core/session";
import { createRateLimiter } from "@solyx/utils/rate-limit";

import {
  LONGBRIDGE_RETRIES,
  LongbridgeError,
  longbridgeAnswer,
} from "./longbridge-api.ts";
import type { LongbridgeApi } from "./longbridge-api.ts";
import { longbridgeDataCenter } from "./longbridge-sign-in.ts";
import {
  AdjustType,
  Command,
  PacketType,
  Period,
  ResponseStatus,
  authRequest,
  bookSide,
  candlesticksRequest,
  decodeCandlesticks,
  decodeClose,
  decodeDepth,
  decodeError,
  decodePacket,
  decodeQuotes,
  decodeStaticInfo,
  decodeTradeDays,
  encodeRequest,
  heartbeatRequest,
  price,
  securitiesRequest,
  tradeDaysRequest,
} from "./longbridge-wire.ts";
import type { Candlestick, Packet, SecurityQuote } from "./longbridge-wire.ts";

const API_URL = "https://openapi.longbridge.com";

const QUOTE_URL =
  "wss://openapi-quote.longbridge.com/v2?version=1&codec=1&platform=9";

// Longbridge takes ten quote requests a second, five at once.
const REQUESTS_PER_SECOND = 10;

const CONCURRENT_REQUESTS = 5;

// What the server waits before it answers a request with a timeout; silence past it and a grace
// means the connection is gone.
const REQUEST_TIMEOUT_MS = 10_000;

const ANSWER_GRACE_MS = 5_000;

// The runtime's WebSocket hides the server's pings, so a heartbeat this often finds a connection
// that died quietly, as one does across a sleep, within a request's timeout of it.
const HEARTBEAT_MS = 30_000;

const MAX_REQUEST_ID = 0xffffffff;

/** The code Longbridge answers a symbol it does not list with. */
export const INVALID_SYMBOL = 301_600;

/** The most bars one request returns: the latest ones, since the range query needs a history quota. */
const MAX_CANDLES = 1000;

/** The most months ahead an exchange sets its trading days for. */
const MONTHS_AHEAD = 12;

const PERIOD: Record<BarInterval, Period> = {
  [Interval.OneMinute]: Period.OneMinute,
  [Interval.FiveMinutes]: Period.FiveMinutes,
  [Interval.FifteenMinutes]: Period.FifteenMinutes,
  [Interval.ThirtyMinutes]: Period.ThirtyMinutes,
  [Interval.OneHour]: Period.OneHour,
  [Interval.OneDay]: Period.Day,
};

const envelopeSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.object({ otp: z.string() }).nullish(),
});

const securityListSchema = z.object({
  list: z.array(
    z.object({
      symbol: z.string(),
      name_hk: z.string().nullish(),
      name_en: z.string().nullish(),
    })
  ),
});

/** A US listing as Longbridge's list names it. */
export interface LongbridgeSecurity {
  /** The exchange's ticker, as a `SymbolRef` writes it. */
  symbol: string;
  /** In traditional Chinese, or English where Longbridge gives no Chinese name. */
  name: string;
  englishName: string | null;
}

const US_SUFFIX = ".US";

/**
 * Every US listing Longbridge trades overnight, the US's exchange-listed stocks and ETFs, with
 * their names. It is the one list Longbridge documents for US listings.
 */
export async function readLongbridgeSecurities(
  api: LongbridgeApi
): Promise<LongbridgeSecurity[]> {
  const data = await api.read(
    "v1/quote/get_security_list",
    { market: Market.US, category: "Overnight" },
    securityListSchema,
    "its list of US listings"
  );

  return data.list.flatMap(({ symbol, name_hk, name_en }) => {
    const name = name_hk || name_en;

    return symbol.endsWith(US_SUFFIX) && name
      ? [
          {
            symbol: symbol.slice(0, -US_SUFFIX.length),
            name,
            englishName: name_en || null,
          },
        ]
      : [];
  });
}

/** The WebSocket surface the client uses, so tests can drive it without a server. */
export interface LongbridgeWebSocket {
  send(data: Uint8Array): void;
  close(): void;
  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (event: { data?: unknown }) => void
  ): void;
}

/** Opens a socket to `url` with the upgrade's headers; tests stand in for the server here. */
export type LongbridgeConnect = (
  url: string,
  headers: Record<string, string>
) => LongbridgeWebSocket;

function openWebSocket(url: string, headers: Record<string, string>) {
  const socket = new WebSocket(url, { headers });

  socket.binaryType = "arraybuffer";

  return socket;
}

export interface LongbridgeSocketOptions {
  /** The signed-in user's OAuth access token, which the caller refreshes before it expires. */
  accessToken: () => Promise<string>;
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
  connect?: LongbridgeConnect;
}

/** A push the server sent: its command and its body. */
export type LongbridgePushListener = (
  command: number,
  body: Uint8Array
) => void;

/** One sign-in's connection to Longbridge's quote server, opened on the first request. */
export interface LongbridgeSocket {
  /** Sends a request once the connection is open and signed in; resolves with the answer's body. */
  request(command: Command, body: Uint8Array): Promise<Uint8Array>;
  /** Hears every push on every connection; returns a function that stops. */
  onPush(listener: LongbridgePushListener): () => void;
  /** Hears a signed-in connection drop, which takes its subscriptions with it; returns a function that stops. */
  onDrop(listener: () => void): () => void;
  close(): void;
}

interface Connection {
  call(command: Command, body: Uint8Array): Promise<Uint8Array>;
  close(): void;
}

/**
 * The quote server's connection for one sign-in. A request opens it when none is open, fetching a
 * one-time password with the access token and signing in with it; a connection that closes,
 * refuses or stops answering is dropped with its requests, and the next request opens another.
 */
export function createLongbridgeSocket({
  accessToken,
  fetch,
  connect = openWebSocket,
}: LongbridgeSocketOptions): LongbridgeSocket {
  const api = ky.create({ baseUrl: API_URL, fetch, ...LONGBRIDGE_RETRIES });

  const budget = createRateLimiter({
    limit: REQUESTS_PER_SECOND,
    windowMs: 1000,
  });

  let current: Promise<Connection> | undefined;
  let closed = false;
  const pushListeners = new Set<LongbridgePushListener>();
  const dropListeners = new Set<() => void>();

  async function oneTimePassword(token: string): Promise<string> {
    const response = await longbridgeAnswer(
      () =>
        api.get("v1/socket/token", {
          headers: {
            authorization: `Bearer ${token}`,
            "x-dc-region": longbridgeDataCenter(token),
          },
        }),
      "the sign-in"
    );

    const envelope = envelopeSchema.safeParse(await response.json());

    if (!envelope.success) {
      throw new LongbridgeError(
        `Longbridge answered the sign-in with HTTP ${response.status}`
      );
    }

    const { code, message, data } = envelope.data;

    if (code !== 0 || !data) {
      throw new LongbridgeError(
        `Longbridge refused the sign-in: ${message}`,
        code
      );
    }

    return data.otp;
  }

  /** `onDrop` hears whether the connection had signed in when it dropped. */
  async function open(
    onDrop: (signedIn: boolean) => void
  ): Promise<Connection> {
    const token = await accessToken();
    const otp = await oneTimePassword(token);

    const socket = connect(QUOTE_URL, {
      "x-dc-region": longbridgeDataCenter(token),
    });

    const pending = new Map<
      number,
      {
        resolve: (body: Uint8Array) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();

    let nextId = 1;
    let dropped: Error | undefined;
    let refuseOpening: ((reason: Error) => void) | undefined;
    let signedIn = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    function drop(reason: Error) {
      if (dropped) return;

      dropped = reason;
      clearInterval(heartbeat);

      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(reason);
      }

      pending.clear();
      refuseOpening?.(reason);
      socket.close();
      onDrop(signedIn);
    }

    function settle(
      packet: Extract<Packet, { type: typeof PacketType.Response }>,
      what: string
    ) {
      const waiting = pending.get(packet.id);

      if (!waiting) return;

      pending.delete(packet.id);
      clearTimeout(waiting.timer);

      if (packet.status === ResponseStatus.Success) {
        waiting.resolve(packet.body);

        return;
      }

      const { code, message } = decodeError(packet.body);

      waiting.reject(
        new LongbridgeError(
          `Longbridge refused ${what}: ${message || `status ${packet.status}`}`,
          code || null
        )
      );
    }

    const purposes = new Map<number, string>();

    function call(
      command: Command,
      body: Uint8Array,
      what = "the request"
    ): Promise<Uint8Array> {
      if (dropped) return Promise.reject(dropped);

      const id = nextId;

      nextId = nextId === MAX_REQUEST_ID ? 1 : nextId + 1;
      purposes.set(id, what);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            drop(
              new LongbridgeError("Longbridge's quote server stopped answering")
            ),
          REQUEST_TIMEOUT_MS + ANSWER_GRACE_MS
        );

        pending.set(id, { resolve, reject, timer });
        socket.send(
          encodeRequest({ command, id, timeoutMs: REQUEST_TIMEOUT_MS, body })
        );
      });
    }

    socket.addEventListener("message", ({ data }) => {
      if (!(data instanceof ArrayBuffer)) return;

      const packet = decodePacket(new Uint8Array(data));

      if (packet?.type === PacketType.Response) {
        settle(packet, purposes.get(packet.id) ?? "the request");
        purposes.delete(packet.id);
      } else if (packet?.command === Command.Close) {
        const { reason } = decodeClose(packet.body);

        drop(
          new LongbridgeError(
            `Longbridge closed the quote connection: ${reason}`
          )
        );
      } else if (packet && !dropped) {
        for (const listener of pushListeners) {
          listener(packet.command, packet.body);
        }
      }
    });

    socket.addEventListener("close", () =>
      drop(new LongbridgeError("Longbridge closed the quote connection"))
    );

    const unreachable = () =>
      drop(
        new LongbridgeError("Longbridge's quote server could not be reached")
      );

    socket.addEventListener("error", unreachable);

    const timer = setTimeout(unreachable, REQUEST_TIMEOUT_MS);

    try {
      await new Promise<void>((resolve, reject) => {
        refuseOpening = reject;
        socket.addEventListener("open", () => resolve());
      });
    } finally {
      clearTimeout(timer);
      refuseOpening = undefined;
    }

    try {
      await call(
        Command.Auth,
        authRequest(otp, { "accept-language": "en" }),
        "the sign-in"
      );
    } catch (error) {
      if (error instanceof Error) drop(error);

      throw error;
    }

    // The server may close the connection on the answer's heels.
    if (dropped) throw dropped;

    signedIn = true;

    // An unanswered heartbeat drops the connection as any unanswered request does.
    heartbeat = setInterval(() => {
      call(
        Command.Heartbeat,
        heartbeatRequest(Date.now()),
        "the heartbeat"
      ).catch(noop);
    }, HEARTBEAT_MS);

    return {
      call,
      close: () =>
        drop(new LongbridgeError("The Longbridge connection closed")),
    };
  }

  function connection(): Promise<Connection> {
    if (closed) {
      return Promise.reject(
        new LongbridgeError("The Longbridge connection closed")
      );
    }

    if (!current) {
      const opening: Promise<Connection> = open((signedIn) => {
        if (current === opening) current = undefined;

        if (signedIn) for (const listener of dropListeners) listener();
      });

      current = opening;
      opening.catch(() => {
        if (current === opening) current = undefined;
      });
    }

    return current;
  }

  const send = limitAsync(
    async (command: Command, body: Uint8Array) =>
      (await connection()).call(command, body),
    CONCURRENT_REQUESTS
  );

  function listen<Listener>(listeners: Set<Listener>, listener: Listener) {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  return {
    request: (command, body) => budget(() => send(command, body)),

    onPush: (listener) => listen(pushListeners, listener),

    onDrop: (listener) => listen(dropListeners, listener),

    close() {
      closed = true;
      void current?.then((opened) => opened.close()).catch(() => undefined);
      current = undefined;
    },
  };
}

/** A bar as traded; none where Longbridge left a price out. */
function tradedBar(bar: Candlestick): Candle[] {
  const open = price(bar.open);
  const high = price(bar.high);
  const low = price(bar.low);
  const close = price(bar.close);

  return open === null || high === null || low === null || close === null
    ? []
    : [{ time: bar.timestamp, open, high, low, close, volume: bar.volume }];
}

/** A forward-adjusted close, and how far its rounding may have moved it, as a fraction of it. */
interface AdjustedClose {
  close: number;
  error: number;
}

function adjustedCloses(
  adjusted: readonly Candlestick[]
): Map<number, AdjustedClose> {
  return new Map(
    adjusted.flatMap((bar): [number, AdjustedClose][] => {
      const close = price(bar.close);
      const decimals = bar.close.split(".")[1]?.length ?? 0;

      return close === null || close <= 0
        ? []
        : [[bar.timestamp, { close, error: (0.5 * 10 ** -decimals) / close }]];
    })
  );
}

/**
 * Daily bars with the reference each session's move counts from, which Longbridge gives only as
 * its forward-adjusted bars: the close before, carried by how much the adjustment changed from that
 * day to this, as a split or a payout changes it. A change within the adjusted closes' rounding
 * moved nothing, so the reference is the close before itself.
 */
function withReferences(
  bars: readonly Candle[],
  adjusted: readonly Candlestick[]
): Candle[] {
  const closes = adjustedCloses(adjusted);

  return bars.map((bar, index) => {
    const previous = index > 0 ? bars[index - 1] : undefined;
    const now = closes.get(bar.time);
    const before = previous && closes.get(previous.time);

    if (!previous || !now || !before) return bar;

    const step = before.close / previous.close / (now.close / bar.close);
    const moved = Math.abs(step - 1) > before.error + now.error;

    return {
      ...bar,
      reference: moved ? previous.close * step : previous.close,
    };
  });
}

const toDate = (day: string) =>
  `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;

const toDay = (date: string) => date.replaceAll("-", "");

export interface LongbridgeMarketDataOptions {
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * US stocks and ETFs from Longbridge's quote server: the latest thousand bars of each interval,
 * since a login without an account has no quota for older ranges, and the days the US market
 * trades as Longbridge lists them, those closing early among them.
 */
export function createLongbridgeMarketData(
  socket: LongbridgeSocket,
  { now = () => new Date() }: LongbridgeMarketDataOptions = {}
): MarketDataProvider & TradingCalendarProvider {
  const id = "longbridge";

  function code(symbol: SymbolRef): string {
    if (symbol.market !== Market.US) {
      throw new Error(`${id} has no data for ${symbol.market} listings`);
    }

    return `${symbol.symbol}.US`;
  }

  /** Sends a request about one listing; `null` when Longbridge does not list it. */
  async function listed<T>(
    command: Command,
    body: Uint8Array,
    read: (answer: Uint8Array) => T
  ): Promise<T | null> {
    try {
      return read(await socket.request(command, body));
    } catch (error) {
      if (error instanceof LongbridgeError && error.code === INVALID_SYMBOL) {
        return null;
      }

      throw error;
    }
  }

  async function securityQuote(
    symbol: SymbolRef
  ): Promise<SecurityQuote | null> {
    const quote = (
      await listed(
        Command.QuerySecurityQuote,
        securitiesRequest([code(symbol)]),
        decodeQuotes
      )
    )?.[0];

    return quote && price(quote.lastDone) !== null ? quote : null;
  }

  async function tradeDays(begin: string, end: string) {
    return decodeTradeDays(
      await socket.request(
        Command.QueryMarketTradeDay,
        tradeDaysRequest(Market.US, toDay(begin), toDay(end))
      )
    );
  }

  return {
    id,
    markets: [Market.US],

    async getCandles({
      symbol,
      interval,
      from,
      to,
    }: CandleRequest): Promise<Candle[]> {
      const read = (adjust: AdjustType) =>
        listed(
          Command.QueryCandlestick,
          candlesticksRequest({
            symbol: code(symbol),
            period: PERIOD[interval],
            count: MAX_CANDLES,
            adjust,
          }),
          decodeCandlesticks
        );

      // Daily bars carry the references the backtests and rotations read splits and payouts from.
      const [traded, adjusted] = await Promise.all([
        read(AdjustType.None),
        interval === Interval.OneDay ? read(AdjustType.Forward) : null,
      ]);

      const bars = (traded ?? [])
        .flatMap(tradedBar)
        .toSorted((a, b) => a.time - b.time);

      return (adjusted ? withReferences(bars, adjusted) : bars).filter(
        (bar) => {
          const date = candleDate(Market.US, bar.time);

          return date >= from && date <= to;
        }
      );
    },

    async getListing(symbol: SymbolRef): Promise<Listing | null> {
      const info = (
        await listed(
          Command.QuerySecurityStaticInfo,
          securitiesRequest([code(symbol)]),
          decodeStaticInfo
        )
      )?.[0];

      if (!info) return null;

      // Longbridge names a US listing in traditional Chinese, as the app's readers know it.
      return {
        name: info.nameHk || info.nameEn,
        englishName: info.nameEn || null,
      };
    },

    async getQuote(symbol: SymbolRef): Promise<Quote | null> {
      const quote = await securityQuote(symbol);
      const last = quote && price(quote.lastDone);
      const reference = quote && price(quote.prevClose);

      if (!quote || last === null || reference === null) return null;

      return {
        date: exchangeDate(Market.US, new Date(quote.timestamp * 1000)),
        last,
        reference,
        tradeValue: price(quote.turnover) ?? 0,
      };
    },

    async getDepth(symbol: SymbolRef): Promise<Depth | null> {
      const [quote, book] = await Promise.all([
        securityQuote(symbol),
        listed(
          Command.QueryDepth,
          securitiesRequest([code(symbol)]),
          decodeDepth
        ),
      ]);

      const reference = quote && price(quote.prevClose);

      if (!quote || !book || reference === null) return null;

      const turnover = price(quote.turnover);

      return {
        date: exchangeDate(Market.US, new Date(quote.timestamp * 1000)),
        time: quote.timestamp * 1000,
        reference,
        open: price(quote.open),
        high: price(quote.high),
        low: price(quote.low),
        last: price(quote.lastDone),
        average:
          turnover !== null && quote.volume > 0
            ? turnover / quote.volume
            : null,
        volume: quote.volume,
        // Longbridge does not split the volume by the side it traded on.
        volumeAtBid: 0,
        volumeAtAsk: 0,
        bids: bookSide(book.bids),
        asks: bookSide(book.asks),
        trial: false,
      };
    },

    async tradingDays(market, since): Promise<ExchangeDays> {
      const days: ExchangeDays = { trading: [], earlyCloses: [] };

      if (market !== Market.US) return days;

      const thisMonth = Temporal.PlainDate.from(
        exchangeDate(Market.US, now())
      ).toPlainYearMonth();

      const last = thisMonth.add({ months: MONTHS_AHEAD });

      // Longbridge answers a month at most per request.
      for (
        let month = Temporal.PlainDate.from(since).toPlainYearMonth();
        Temporal.PlainYearMonth.compare(month, last) <= 0;
        month = month.add({ months: 1 })
      ) {
        const first = month.toPlainDate({ day: 1 }).toString();

        const begin = first < since ? since : first;

        const end = month.toPlainDate({ day: month.daysInMonth }).toString();

        const ahead = Temporal.PlainYearMonth.compare(month, thisMonth) > 0;

        let listed: ReturnType<typeof decodeTradeDays>;

        try {
          listed = await tradeDays(begin, end);
        } catch (error) {
          // A month the exchange has not set yet ends the calendar.
          if (ahead && error instanceof LongbridgeError) break;

          throw error;
        }

        if (ahead && listed.trading.length + listed.halfDays.length === 0) {
          break;
        }

        days.trading.push(
          ...[...listed.trading, ...listed.halfDays].map(toDate).toSorted()
        );
        days.earlyCloses.push(...listed.halfDays.map(toDate).toSorted());
      }

      return days;
    },
  };
}
