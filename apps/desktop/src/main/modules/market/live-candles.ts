import { MemoryPublisher } from "@orpc/publisher/memory";
import { noop, throttle } from "es-toolkit";

import {
  Interval,
  candleDate,
  isCalendarInterval,
  isIntraday,
  liveBar,
  periodStart,
} from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { exchangeDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { CandleRequest, MarketDataStream } from "@solyx/core/market-data";
import { shiftDate } from "@solyx/utils/date";

// A busy symbol pushes several times a second; windows hear about it at most four times.
const FLUSH_MS = 250;

/** A watched symbol's forming bar in one interval; it replaces the bar with the same time. */
export interface LiveCandle {
  symbol: SymbolRef;
  interval: Interval;
  candle: Candle;
}

/** Where one watch's bars go: a window's stream of them, or a test. */
export interface LiveSender {
  send(updates: LiveCandle[]): void;
}

interface Watch {
  interval: Interval;
  /** Due the whole session on the next flush, as after it starts or its period loads. */
  fresh: boolean;
  /** The current week's or month's closed daily bars, for the date they were loaded. */
  period?: { date: string; daily: Candle[] };
  loading?: string;
}

interface LiveSymbol {
  symbol: SymbolRef;
  stop: () => void;
  /** One session's minute bars by time. */
  minutes: Map<number, Candle>;
  /** Minute times changed since the last flush. */
  touched: Set<number>;
  watches: Map<LiveSender, Watch>;
}

interface LiveCandlesOptions {
  /** Opens the provider's stream, or resolves `undefined` when its key is not saved. */
  openStream(): Promise<MarketDataStream | undefined>;
  /** Closed daily bars, which the current week's and month's bars start from. */
  dailyCandles(request: CandleRequest): Promise<Candle[]>;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Keeps today's minute bars for every watched symbol and pushes each window the bars of the
 * intervals it watches. Only today's session is pushed: earlier sessions come from history.
 */
export function createLiveCandles(options: LiveCandlesOptions) {
  const now = options.now ?? (() => new Date());
  const live = new Map<string, LiveSymbol>();
  let stream: MarketDataStream | undefined;
  let opening: Promise<MarketDataStream | undefined> | undefined;

  function ensureStream(): Promise<MarketDataStream | undefined> {
    if (stream) return Promise.resolve(stream);

    opening ??= open();

    return opening;
  }

  function open() {
    const attempt: Promise<MarketDataStream | undefined> = options
      .openStream()
      .then((opened) => {
        // A restart while this one opened makes its stream stale, so callers get the current one.
        if (opening !== attempt) {
          opened?.close();

          return ensureStream();
        }

        stream = opened;
        opening = undefined;

        return opened;
      });

    // A failed open is tried again by the next caller.
    void attempt.catch(() => {
      if (opening === attempt) opening = undefined;
    });

    return attempt;
  }

  function loadPeriod(state: LiveSymbol, watch: Watch, date: string) {
    if (!isCalendarInterval(watch.interval) || watch.loading === date) return;

    watch.loading = date;

    options
      .dailyCandles({
        symbol: state.symbol,
        interval: Interval.OneDay,
        from: periodStart(date, watch.interval),
        to: shiftDate(date, -1),
      })
      .then(
        (daily) => {
          watch.period = { date, daily };
          watch.fresh = true;
          flush();
        },
        () => {
          // Without the period's earlier sessions the bar would be wrong, so history keeps it.
        }
      );
  }

  function barsFor(
    state: LiveSymbol,
    watch: Watch,
    minutes: Candle[],
    touched: number[],
    today: string
  ): Candle[] {
    if (isCalendarInterval(watch.interval) && watch.period?.date !== today) {
      loadPeriod(state, watch, today);

      return [];
    }

    const changed = watch.fresh
      ? minutes.map((minute) => minute.time)
      : touched;

    watch.fresh = false;

    if (changed.length === 0) return [];

    // Every minute of the session feeds the daily, weekly and monthly bar alike.
    const times = isIntraday(watch.interval)
      ? changed
      : [minutes[minutes.length - 1].time];

    const bars = new Map<number, Candle>();

    for (const time of times) {
      const bar = liveBar(
        minutes,
        time,
        watch.interval,
        state.symbol.market,
        watch.period?.daily
      );

      if (bar) bars.set(bar.time, bar);
    }

    return [...bars.values()].sort((left, right) => left.time - right.time);
  }

  const flush = throttle(() => {
    const outbox = new Map<LiveSender, LiveCandle[]>();

    for (const state of live.values()) {
      const touched = [...state.touched];

      state.touched.clear();

      const minutes = [...state.minutes.values()].sort(
        (left, right) => left.time - right.time
      );

      const today = exchangeDate(state.symbol.market, now());

      if (
        minutes.length === 0 ||
        candleDate(state.symbol.market, minutes[0].time) !== today
      ) {
        continue;
      }

      for (const [sender, watch] of state.watches) {
        const updates = barsFor(state, watch, minutes, touched, today).map(
          (candle) => ({
            symbol: state.symbol,
            interval: watch.interval,
            candle,
          })
        );

        outbox.set(sender, [...(outbox.get(sender) ?? []), ...updates]);
      }
    }

    for (const [sender, updates] of outbox) {
      if (updates.length > 0) sender.send(updates);
    }
  }, FLUSH_MS);

  function listen(state: LiveSymbol, opened: MarketDataStream) {
    return opened.watchMinutes(state.symbol, {
      onSession(minutes) {
        state.minutes = new Map(minutes.map((minute) => [minute.time, minute]));

        for (const watch of state.watches.values()) watch.fresh = true;

        flush();
      },
      onMinute(minute) {
        const first = state.minutes.values().next().value;

        // A minute from a later session starts that session over.
        if (
          first &&
          candleDate(state.symbol.market, first.time) !==
            candleDate(state.symbol.market, minute.time)
        ) {
          state.minutes.clear();
        }

        state.minutes.set(minute.time, minute);
        state.touched.add(minute.time);
        flush();
      },
    });
  }

  function release(state: LiveSymbol) {
    if (state.watches.size > 0) return;

    state.stop();
    live.delete(symbolKey(state.symbol));
  }

  async function watch(
    sender: LiveSender,
    symbol: SymbolRef,
    interval: Interval
  ): Promise<boolean> {
    const opened = await ensureStream();

    if (!opened) return false;

    let state = live.get(symbolKey(symbol));

    if (!state) {
      const created: LiveSymbol = {
        symbol,
        stop: noop,
        minutes: new Map(),
        touched: new Set(),
        watches: new Map(),
      };

      const stop = listen(created, opened);

      if (!stop) return false;

      created.stop = stop;
      live.set(symbolKey(symbol), created);
      state = created;
    }

    // A symbol that was already live sends only this watch its whole session.
    const added: Watch = { interval, fresh: true };

    state.watches.set(sender, added);
    loadPeriod(state, added, exchangeDate(symbol.market, now()));

    if (state.minutes.size > 0) flush();

    return true;
  }

  function unwatch(sender: LiveSender, symbol: SymbolRef) {
    const state = live.get(symbolKey(symbol));

    if (!state?.watches.delete(sender)) return;

    release(state);
  }

  return {
    watch,
    unwatch,

    /**
     * Today's bars of `symbol` in `interval` as they change, a batch for each push: an empty one
     * first once a live stream covers the symbol, and none, with the end at once, when none does.
     * Watches until `signal` aborts or the caller stops reading.
     */
    async *follow(
      symbol: SymbolRef,
      interval: Interval,
      signal?: AbortSignal
    ): AsyncGenerator<Candle[]> {
      const batches = new MemoryPublisher<{
        bars: { updates: LiveCandle[] };
      }>();

      const sender: LiveSender = {
        send: (updates) => void batches.publish("bars", { updates }),
      };

      // Read from before the watch, whose first flush may come at once.
      const pushed = batches.subscribe("bars", { signal });

      try {
        if (!(await watch(sender, symbol, interval))) return;

        yield [];

        for await (const { updates } of pushed) {
          yield updates.map((update) => update.candle);
        }
      } finally {
        unwatch(sender, symbol);
        await pushed.return();
      }
    },

    /**
     * Reopens the stream, as after the provider's key changes, and watches every symbol again;
     * a symbol the new stream refuses stops being live.
     */
    async restart() {
      const previous = stream;

      stream = undefined;
      opening = undefined;

      for (const state of live.values()) state.stop();

      previous?.close();

      if (live.size === 0) return;

      const opened = await ensureStream();

      for (const [key, state] of live) {
        const stop = opened && listen(state, opened);

        if (stop) {
          state.stop = stop;
        } else {
          live.delete(key);
        }
      }
    },
  };
}
