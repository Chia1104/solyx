import { chunk } from "es-toolkit";
import * as z from "zod";

import { Interval, candleDate } from "@solyx/core/candles";
import type { BarInterval, Candle } from "@solyx/core/candles";
import { Market, exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type {
  CandleRequest,
  Depth,
  DepthLevel,
  Listing,
  MarketDataProvider,
  Quote,
} from "@solyx/core/market-data";
import type {
  ExchangeDays,
  TradingCalendarProvider,
} from "@solyx/core/session";
import { LongbridgeError } from "@solyx/longbridge/client";
import type { Longbridge } from "@solyx/longbridge/client";
import {
  AdjustType,
  Command,
  Period,
  candlesticksRequest,
  decodeCandlesticks,
  decodeDepth,
  decodeQuotes,
  decodeStaticInfo,
  decodeTradeDays,
  price,
  securitiesRequest,
  tradeDaysRequest,
} from "@solyx/longbridge/wire";
import type {
  BookEntry,
  Candlestick,
  SecurityQuote,
} from "@solyx/longbridge/wire";

/** The code Longbridge answers a symbol it does not list with. */
export const INVALID_SYMBOL = 301_600;

/** The most symbols one quote request takes. */
const MAX_QUOTE_SYMBOLS = 500;

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
  api: Pick<Longbridge, "read">
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

/** One side of a book, best first, without the empty levels Longbridge pads it with. */
export const bookSide = (levels: readonly BookEntry[]): DepthLevel[] =>
  levels
    .toSorted((a, b) => a.position - b.position)
    .flatMap(({ price: text, volume }) => {
      const value = price(text);

      return value === null || volume === 0
        ? []
        : [{ price: value, shares: volume }];
    });

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
/**
 * Quotes asked for within one turn of the event loop, read together in requests of up to
 * `MAX_QUOTE_SYMBOLS`, so a market's sector funds cost one request rather than one each. `read`
 * answers `null` where Longbridge does not list a symbol asked for, which fails the request whole,
 * so then each is asked alone; a symbol it lists no quote of has none.
 */
function batchQuotes(
  read: (codes: readonly string[]) => Promise<SecurityQuote[] | null>
) {
  let waiting:
    | { codes: Set<string>; answer: Promise<Map<string, SecurityQuote>> }
    | undefined;

  async function quotes(
    codes: readonly string[]
  ): Promise<Map<string, SecurityQuote>> {
    const found = await read(codes);

    if (found) return new Map(found.map((quote) => [quote.symbol, quote]));

    if (codes.length === 1) return new Map();

    const each = await Promise.all(codes.map((one) => quotes([one])));

    return new Map(each.flatMap((one) => [...one]));
  }

  return async (code: string): Promise<SecurityQuote | null> => {
    if (!waiting) {
      const codes = new Set<string>();

      waiting = {
        codes,
        // Read once every caller of this turn has named its symbol.
        answer: new Promise((resolve) => setTimeout(resolve, 0)).then(
          async () => {
            waiting = undefined;

            const each = await Promise.all(
              chunk([...codes], MAX_QUOTE_SYMBOLS).map(quotes)
            );

            return new Map(each.flatMap((one) => [...one]));
          }
        ),
      };
    }

    waiting.codes.add(code);

    return (await waiting.answer).get(code) ?? null;
  };
}

export function createLongbridgeMarketData(
  longbridge: Pick<Longbridge, "request">,
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
      return read(await longbridge.request(command, body));
    } catch (error) {
      if (error instanceof LongbridgeError && error.code === INVALID_SYMBOL) {
        return null;
      }

      throw error;
    }
  }

  const quoteOf = batchQuotes((codes) =>
    listed(Command.QuerySecurityQuote, securitiesRequest(codes), decodeQuotes)
  );

  async function securityQuote(
    symbol: SymbolRef
  ): Promise<SecurityQuote | null> {
    const quote = await quoteOf(code(symbol));

    return quote && price(quote.lastDone) !== null ? quote : null;
  }

  async function tradeDays(begin: string, end: string) {
    return decodeTradeDays(
      await longbridge.request(
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
