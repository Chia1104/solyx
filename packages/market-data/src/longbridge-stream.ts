import { noop } from "es-toolkit";

import { Interval, candleDate } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market, exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type {
  Depth,
  MarketDataProvider,
  MarketDataStream,
  MinuteListener,
} from "@solyx/core/market-data";
import { regularHours, weekdays } from "@solyx/core/session";
import type { TradingDays } from "@solyx/core/session";

import {
  Command,
  SubType,
  TradeSession,
  bookSide,
  decodeDepthPush,
  decodeQuotePush,
  decodeTradePush,
  price,
  subscribeRequest,
  unsubscribeRequest,
} from "./longbridge-wire.ts";
import type { BookEntry, QuotePush, Trade } from "./longbridge-wire.ts";
import { INVALID_SYMBOL, LongbridgeError } from "./longbridge.ts";
import type { LongbridgeSocket } from "./longbridge.ts";

/** What one sign-in holds subscribed at once, every listing's bars and books between them. */
const MAX_SUBSCRIPTIONS = 500;

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** What a regular-session sale counts toward its minute's bar. */
const SaleCounts = {
  PriceAndVolume: "price-and-volume",
  Volume: "volume",
} as const;

type SaleCounts = (typeof SaleCounts)[keyof typeof SaleCounts];

// By the condition the exchange reported a US sale under, as Longbridge's SDK (MIT OR Apache-2.0)
// reads them for stocks; a condition not listed, such as a late report, counts for nothing.
const SALE_CONDITIONS = new Map<string, SaleCounts>([
  ...["", "A", "B", "D", "E", "F", "K", "S", "X", "1"].map(
    (condition) => [condition, SaleCounts.PriceAndVolume] as const
  ),
  // Odd lots among them, which trade off the consolidated last price.
  ...["C", "G", "H", "I", "V", "W"].map(
    (condition) => [condition, SaleCounts.Volume] as const
  ),
]);

/** A sale as it counts toward its minute's bar. */
interface Sale {
  /** UTC seconds of the minute it lands in. */
  time: number;
  value: number;
  volume: number;
  /** Whether it sets the bar's price, or only adds its shares. */
  priced: boolean;
}

/** A regular-session sale before the close, as it counts; `undefined` for one counting toward no bar. */
function saleOf(trade: Trade, days: TradingDays): Sale | undefined {
  const counts = SALE_CONDITIONS.get(trade.tradeType);
  const value = price(trade.price);

  if (
    !counts ||
    value === null ||
    trade.tradeSession !== TradeSession.Regular
  ) {
    return undefined;
  }

  const time = trade.timestamp - (trade.timestamp % 60);

  const { open, close } = regularHours(
    Market.US,
    candleDate(Market.US, time),
    days
  );

  // A closing auction's prints come after the close, which no bar holds.
  if (time < open || time >= close) return undefined;

  return {
    time,
    value,
    volume: trade.volume,
    priced: counts === SaleCounts.PriceAndVolume,
  };
}

/** `bar` with `sale` added; `afresh` where it is the first priced sale of a bar opened at the close before. */
function withSale(bar: Candle, sale: Sale, afresh: boolean): Candle {
  const volume = bar.volume + sale.volume;

  if (!sale.priced) return { ...bar, volume };

  const from = afresh
    ? { ...bar, open: sale.value, high: sale.value, low: sale.value }
    : bar;

  return {
    ...from,
    high: Math.max(from.high, sale.value),
    low: Math.min(from.low, sale.value),
    close: sale.value,
    volume,
  };
}

const Channel = {
  Minutes: "minutes",
  Book: "book",
} as const;

type Channel = (typeof Channel)[keyof typeof Channel];

const SUB_TYPES: Record<Channel, SubType[]> = {
  [Channel.Minutes]: [SubType.Trade],
  [Channel.Book]: [SubType.Quote, SubType.Depth],
};

interface Subscription<Listener> {
  listeners: Set<Listener>;
  /** Subscribed on the connection open now. */
  live: boolean;
  loading: boolean;
  /** Longbridge has nothing to push of it, so it is not asked again. */
  unlisted: boolean;
}

interface MinuteWatch extends Subscription<MinuteListener> {
  /** The session's bars by time, oldest first, once loaded; sales before then are not merged. */
  bars: Map<number, Candle> | undefined;
  /** Bars a sale counting only its volume opened at the close before, which the first priced sale sets. */
  unpriced: Set<number>;
  /** The newest bar's time; a sale for an earlier minute only adds to a bar it has. */
  tail: number | undefined;
  days: TradingDays;
}

interface BookWatch extends Subscription<(depth: Depth) => void> {
  /** Read before subscribing, since a quote push carries no close before it. */
  depth: Depth | undefined;
  /** Each side's levels by position as pushed, since a push carries only the levels that changed. */
  levels: { bids: Map<number, BookEntry>; asks: Map<number, BookEntry> };
}

interface Watched {
  symbol: SymbolRef;
  /** Longbridge's code for it, as its pushes name it. */
  code: string;
  [Channel.Minutes]?: MinuteWatch;
  [Channel.Book]?: BookWatch;
}

export interface LongbridgeStreamOptions {
  /** The sign-in's connection, which the provider's requests share, since Longbridge allows one. */
  socket: LongbridgeSocket;
  /** Where a watch starts from: the session's minute bars so far and the book as it stands. */
  provider: Pick<MarketDataProvider, "getCandles" | "getDepth">;
  /** The days the US trades, which tell when a regular session closes early. @default () => weekdays */
  tradingDays?: () => Promise<TradingDays>;
  /** @default () => new Date() */
  now?: () => Date;
}

const subscriptionOf = <Listener>(): Subscription<Listener> => ({
  listeners: new Set(),
  live: false,
  loading: false,
  unlisted: false,
});

/**
 * Live minute bars and books of US listings over a sign-in's Longbridge connection. Bars are
 * merged from the regular session's sales, since Longbridge pushes no bars; a watch starts from
 * the session's bars so far, and a connection that drops is subscribed again from them.
 */
export function createLongbridgeStream({
  socket,
  provider,
  tradingDays = async () => weekdays,
  now = () => new Date(),
}: LongbridgeStreamOptions): MarketDataStream {
  const watched = new Map<string, Watched>();
  let closed = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const subscriptions = () =>
    [...watched.values()].reduce(
      (count, entry) => count + Number(!!entry.minutes) + Number(!!entry.book),
      0
    );

  function unsubscribe(code: string, channel: Channel) {
    // A request that fails went with a connection that dropped, and its subscriptions with it.
    socket
      .request(
        Command.Unsubscribe,
        unsubscribeRequest([code], SUB_TYPES[channel])
      )
      .catch(noop);
  }

  /** Subscribes `watch`, or takes it off again where it stopped meanwhile; resolves whether it is live. */
  async function subscribe(
    entry: Watched,
    channel: Channel,
    watch: MinuteWatch | BookWatch
  ): Promise<boolean> {
    await socket.request(
      Command.Subscribe,
      subscribeRequest(
        [entry.code],
        SUB_TYPES[channel],
        channel === Channel.Book
      )
    );

    if (entry[channel] === watch && !closed) return true;

    unsubscribe(entry.code, channel);

    return false;
  }

  // The session's bars are sent before subscribing, so each sale pushed after lands on them.
  async function loadMinutes(entry: Watched, watch: MinuteWatch) {
    const today = exchangeDate(Market.US, now());

    const [session, days] = await Promise.all([
      provider.getCandles({
        symbol: entry.symbol,
        interval: Interval.OneMinute,
        from: today,
        to: today,
      }),
      tradingDays(),
    ]);

    if (entry.minutes !== watch || closed) return false;

    watch.bars = new Map(session.map((bar) => [bar.time, bar]));
    watch.unpriced.clear();
    watch.tail = session.at(-1)?.time;
    watch.days = days;

    for (const listener of watch.listeners) listener.onSession(session);

    return subscribe(entry, Channel.Minutes, watch);
  }

  async function loadBook(entry: Watched, watch: BookWatch) {
    const depth = await provider.getDepth(entry.symbol);

    if (entry.book !== watch || closed) return false;

    if (!depth) {
      watch.unlisted = true;

      return false;
    }

    // Subscribing pushes the whole book first, which the levels start from.
    watch.depth = depth;
    watch.levels.bids.clear();
    watch.levels.asks.clear();

    return subscribe(entry, Channel.Book, watch);
  }

  function scheduleRetry() {
    if (closed || retry) return;

    const delay =
      RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];

    failures += 1;
    retry = setTimeout(() => {
      retry = undefined;

      for (const entry of watched.values()) start(entry);
    }, delay);
  }

  async function track(
    watch: Subscription<unknown>,
    loading: () => Promise<boolean>
  ) {
    if (watch.live || watch.loading || watch.unlisted) return;

    watch.loading = true;

    try {
      watch.live = await loading();

      if (watch.live) failures = 0;
    } catch (error) {
      if (error instanceof LongbridgeError && error.code === INVALID_SYMBOL) {
        watch.unlisted = true;
      } else {
        scheduleRetry();
      }
    } finally {
      watch.loading = false;
    }
  }

  /** Loads and subscribes whatever of `entry` is not live. */
  function start(entry: Watched) {
    const { minutes, book } = entry;

    if (minutes) void track(minutes, () => loadMinutes(entry, minutes));

    if (book) void track(book, () => loadBook(entry, book));
  }

  /** The listing's entry once it may take `channel`; `undefined` past the subscriptions a sign-in holds. */
  function admit(symbol: SymbolRef, channel: Channel): Watched | undefined {
    if (symbol.market !== Market.US || closed) return undefined;

    const code = `${symbol.symbol}.US`;
    const known = watched.get(code);

    if (!known?.[channel] && subscriptions() >= MAX_SUBSCRIPTIONS) {
      return undefined;
    }

    const entry = known ?? { symbol, code };

    watched.set(code, entry);

    return entry;
  }

  function release(entry: Watched, channel: Channel) {
    const watch = entry[channel];

    delete entry[channel];

    if (!entry.minutes && !entry.book) watched.delete(entry.code);

    if (watch?.live) unsubscribe(entry.code, channel);
  }

  /** Starts the bars over for a sale from a later session; `false` for one from an earlier session, which is stale. */
  function sameSession(watch: MinuteWatch, time: number): boolean {
    const { tail } = watch;

    if (tail === undefined) return true;

    if (candleDate(Market.US, tail) === candleDate(Market.US, time))
      return true;

    if (time < tail) return false;

    watch.bars?.clear();
    watch.unpriced.clear();
    watch.tail = undefined;

    return true;
  }

  /** The minute the sale lands in, merged into its bar; `undefined` where it counts toward none. */
  function mergeSale(watch: MinuteWatch, trade: Trade): number | undefined {
    const sale = saleOf(trade, watch.days);
    const bars = watch.bars;

    if (!bars || !sale || !sameSession(watch, sale.time)) return undefined;

    const { time, value, priced } = sale;
    const bar = bars.get(time);

    if (bar) {
      bars.set(
        time,
        withSale(bar, sale, priced && watch.unpriced.delete(time))
      );

      return time;
    }

    const previous =
      watch.tail === undefined ? undefined : bars.get(watch.tail);

    // A late sale for a minute without a bar, or one that sets no price before any bar has.
    if (
      (watch.tail !== undefined && time < watch.tail) ||
      (!priced && !previous)
    ) {
      return undefined;
    }

    const start = priced || !previous ? value : previous.close;

    bars.set(time, {
      time,
      open: start,
      high: start,
      low: start,
      close: start,
      volume: sale.volume,
    });

    if (!priced) watch.unpriced.add(time);

    watch.tail = time;

    return time;
  }

  function onTrades(body: Uint8Array) {
    const { symbol, trades } = decodeTradePush(body);
    const watch = watched.get(symbol)?.minutes;

    if (!watch?.bars) return;

    const touched = new Set<number>();

    for (const trade of trades) {
      const time = mergeSale(watch, trade);

      if (time !== undefined) touched.add(time);
    }

    for (const time of [...touched].sort((a, b) => a - b)) {
      const bar = watch.bars.get(time);

      if (!bar) continue;

      for (const listener of watch.listeners) listener.onMinute(bar);
    }
  }

  // Pushes carry no time of their own for a book, so a change is timed as it arrives.
  const arrived = (depth: Depth) => Math.max(depth.time, now().getTime());

  // Longbridge leaves a figure out of a push when it did not change, which holds within a session.
  function quoted(depth: Depth, push: QuotePush): Depth {
    const date = exchangeDate(Market.US, new Date(push.timestamp * 1000));
    const same = date === depth.date;

    const figure = (text: string, before: number | null) =>
      price(text) || (same ? before : null);

    const volume = push.volume || (same ? depth.volume : 0);
    const turnover = price(push.turnover);
    const average = turnover && volume > 0 ? turnover / volume : null;

    return {
      ...depth,
      date,
      time: arrived(depth),
      // A new session's move counts from the last price of the one before it.
      reference: same ? depth.reference : (depth.last ?? depth.reference),
      open: figure(push.open, depth.open),
      high: figure(push.high, depth.high),
      low: figure(push.low, depth.low),
      last: price(push.lastDone) || depth.last,
      average: average ?? (same ? depth.average : null),
      volume,
    };
  }

  function publish(watch: BookWatch, depth: Depth) {
    watch.depth = depth;

    for (const listener of watch.listeners) listener(depth);
  }

  function onQuote(body: Uint8Array) {
    const push = decodeQuotePush(body);
    const watch = watched.get(push.symbol)?.book;

    // The book's session figures are the regular session's, as its read gave them.
    if (
      !watch?.depth ||
      push.endOfDay ||
      push.tradeSession !== TradeSession.Regular
    ) {
      return;
    }

    publish(watch, quoted(watch.depth, push));
  }

  /** A side's levels with a push's changes; the read's side stands until a push has given one. */
  function side(
    levels: Map<number, BookEntry>,
    changed: readonly BookEntry[],
    read: Depth["bids"]
  ): Depth["bids"] {
    for (const entry of changed) levels.set(entry.position, entry);

    return levels.size > 0 ? bookSide([...levels.values()]) : read;
  }

  function onBook(body: Uint8Array) {
    const push = decodeDepthPush(body);
    const watch = watched.get(push.symbol)?.book;

    if (!watch?.depth) return;

    publish(watch, {
      ...watch.depth,
      time: arrived(watch.depth),
      bids: side(watch.levels.bids, push.bids, watch.depth.bids),
      asks: side(watch.levels.asks, push.asks, watch.depth.asks),
    });
  }

  const stopPushes = socket.onPush((command, body) => {
    if (command === Command.PushTrade) onTrades(body);
    else if (command === Command.PushQuote) onQuote(body);
    else if (command === Command.PushDepth) onBook(body);
  });

  const stopDrops = socket.onDrop(() => {
    for (const { minutes, book } of watched.values()) {
      if (minutes) minutes.live = false;

      if (book) book.live = false;
    }

    if (watched.size > 0) scheduleRetry();
  });

  return {
    id: "longbridge",
    markets: [Market.US],

    watchMinutes(symbol, listener) {
      const entry = admit(symbol, Channel.Minutes);

      if (!entry) return undefined;

      const watch: MinuteWatch = entry.minutes ?? {
        ...subscriptionOf<MinuteListener>(),
        bars: undefined,
        unpriced: new Set(),
        tail: undefined,
        days: weekdays,
      };

      entry.minutes = watch;
      watch.listeners.add(listener);

      // A listing loaded already starts this listener from its bars; a load under way sends them again.
      if (watch.bars) {
        const session = [...watch.bars.values()];

        queueMicrotask(() => {
          if (watch.listeners.has(listener)) listener.onSession(session);
        });
      }

      start(entry);

      return () => {
        watch.listeners.delete(listener);

        if (watch.listeners.size === 0 && entry.minutes === watch) {
          release(entry, Channel.Minutes);
        }
      };
    },

    watchDepth(symbol, listener) {
      const entry = admit(symbol, Channel.Book);

      if (!entry) return undefined;

      const watch: BookWatch = entry.book ?? {
        ...subscriptionOf<(depth: Depth) => void>(),
        depth: undefined,
        levels: { bids: new Map(), asks: new Map() },
      };

      entry.book = watch;
      watch.listeners.add(listener);
      start(entry);

      return () => {
        watch.listeners.delete(listener);

        if (watch.listeners.size === 0 && entry.book === watch) {
          release(entry, Channel.Book);
        }
      };
    },

    close() {
      closed = true;
      clearTimeout(retry);
      stopPushes();
      stopDrops();

      for (const entry of watched.values()) {
        if (entry.minutes) release(entry, Channel.Minutes);

        if (entry.book) release(entry, Channel.Book);
      }
    },
  };
}
