import { groupBy, noop, omit } from "es-toolkit";

import {
  BrokerMode,
  BrokerOrderStatus,
  OrderRefusedError,
} from "@solyx/core/broker";
import type { BrokerAdapter, WatchedExitLeg } from "@solyx/core/broker";
import type { Candle } from "@solyx/core/candles";
import {
  Market,
  currencyOf,
  exchangeDate,
  symbolKey,
} from "@solyx/core/market";
import type { Currency, SymbolRef } from "@solyx/core/market";
import { ExitLeg, OrderType, Side, exitLegs } from "@solyx/core/order";
import type { AccountSnapshot, Fill, OrderRequest } from "@solyx/core/order";
import { MINUTE_MS } from "@solyx/utils/date";
import { errorMessage } from "@solyx/utils/error";

export interface PaperAccount extends AccountSnapshot {
  /** Orders filled so far, which numbers the next one. */
  orders: number;
}

/** An order the paper account filled whole, which is the only way it fills one. */
export interface PaperFill extends Fill {
  /** The tag the order was placed with; `null` for one placed without. */
  tag: string | null;
  /** The order's limit price; `null` for a market order. */
  limitPrice: number | null;
}

/** An exit leg the paper account watches. */
export interface PaperExitLeg extends WatchedExitLeg {
  /** The tag its exit was placed with, which its siblings share and its sale's fill keeps. */
  tag: string;
  /** The last exchange-local day it is watched. */
  until: string;
}

/**
 * Where the paper account is kept, so it outlives the app as its proposals do. Synchronous, so an
 * order reads and writes the account with no other order in between.
 */
export interface PaperLedger {
  /** `undefined` before the account's first order. */
  read(): PaperAccount | undefined;
  /**
   * Keeps the account as an order left it, and the order's fill, in one write, with the exit legs
   * `ended` dropped where the order was an exit's sale.
   */
  write(
    account: PaperAccount,
    fill: PaperFill,
    ended?: readonly string[]
  ): void;
  /** The fills from `since`, UTC milliseconds, on, oldest first. */
  fills(since: number): PaperFill[];
  /** The exit legs the account watches, oldest first. */
  exitLegs(): PaperExitLeg[];
  /** Keeps an exit's legs, all of them or none. */
  addExitLegs(legs: readonly PaperExitLeg[]): void;
  removeExitLegs(refs: readonly string[]): void;
}

export interface PaperBrokerOptions {
  /** What the account opens with. */
  cash: Partial<Record<Currency, number>>;
  ledger: PaperLedger;
  /** Only market orders and exits need it; limit orders fill at their limit price. */
  getLastPrice?: (instrument: SymbolRef) => Promise<number>;
  /**
   * Today's minute bars of `instrument` as they form, a batch for each push, until `signal`
   * aborts or no stream covers it, which exits are checked against as they come.
   * @default none, so exits are checked against the last price only when the desk asks
   */
  bars?: (
    instrument: SymbolRef,
    signal: AbortSignal
  ) => AsyncIterable<Candle[]>;
  /** Called once a bar sold an exit, a change to the account no one asked for, so its holder can look again. */
  onExitSold?: () => void;
  /** @default Date.now */
  now?: () => number;
}

/**
 * Fills every order immediately and in full. No fees, no securities transaction tax, no shorting —
 * good enough to exercise the order flow, not to judge a strategy. An order it cannot fill is
 * refused, since it changes nothing before the fill is written. It watches an exit's listing on
 * the live bars it is given while the app runs: the first minute bar after the exit was placed and
 * this run began following the listing that reaches a leg sells the exit whole there, at the leg's price, or at the bar's open where it
 * opened past it, and ends its siblings in the same write, so one sale ends the exit. Asked what it
 * watches, it checks the last price too, for a listing no stream covers, and ends the exits whose
 * last day has passed unsold.
 */
export function createPaperBroker(options: PaperBrokerOptions): BrokerAdapter {
  const { ledger, now = Date.now } = options;

  const account = (): PaperAccount =>
    ledger.read() ?? {
      cash: { ...options.cash },
      positions: [],
      orders: 0,
    };

  async function fillPrice(order: OrderRequest): Promise<number> {
    if (order.type === OrderType.Limit) return order.limitPrice;

    if (!options.getLastPrice)
      throw new OrderRefusedError(
        "The paper account has no price source, so it cannot fill market orders"
      );

    try {
      return await options.getLastPrice(order.instrument);
    } catch (error) {
      throw new OrderRefusedError(
        `The paper account could not price the market order: ${errorMessage(error)}`,
        { cause: error }
      );
    }
  }

  /** Fills `order` whole at `price`, dropping the exit legs `ended` in the same write. */
  function fill(
    order: OrderRequest,
    price: number,
    tag: string | null,
    ended: readonly string[] = []
  ) {
    const { cash, positions: held, orders } = account();
    const currency = currencyOf(order.instrument.market);
    const key = symbolKey(order.instrument);

    const positions = new Map(
      held.map((position) => [symbolKey(position.instrument), position])
    );

    const position = positions.get(key);
    const notional = price * order.quantity;
    let realized: number | null = null;

    if (order.side === Side.Buy) {
      const available = cash[currency] ?? 0;

      if (notional > available)
        throw new OrderRefusedError(
          `Insufficient ${currency} in the paper account`
        );
      cash[currency] = available - notional;
      const quantity = (position?.quantity ?? 0) + order.quantity;

      const cost =
        (position ? position.avgPrice * position.quantity : 0) + notional;

      positions.set(key, {
        instrument: order.instrument,
        quantity,
        avgPrice: cost / quantity,
      });
    } else {
      if (!position || position.quantity < order.quantity) {
        throw new OrderRefusedError(
          "Not enough shares in the paper account (short selling is not supported)"
        );
      }

      cash[currency] = (cash[currency] ?? 0) + notional;
      realized = (price - position.avgPrice) * order.quantity;
      const quantity = position.quantity - order.quantity;

      if (quantity === 0) positions.delete(key);
      else positions.set(key, { ...position, quantity });
    }

    const orderId = `paper-${orders + 1}`;

    ledger.write(
      { cash, positions: [...positions.values()], orders: orders + 1 },
      {
        orderId,
        instrument: order.instrument,
        side: order.side,
        quantity: order.quantity,
        price,
        filledAt: now(),
        realized,
        tag,
        limitPrice: order.type === OrderType.Limit ? order.limitPrice : null,
      },
      ended
    );

    return { orderId };
  }

  /** Sells the exit whose legs are `legs` whole at `price`, or ends it unsold where its shares are gone. */
  function sellExit(legs: readonly PaperExitLeg[], price: number) {
    const [first] = legs;

    if (!first) return;

    const { instrument, quantity, tag } = first;
    const refs = legs.map(({ ref }) => ref);

    try {
      fill(
        { instrument, side: Side.Sell, quantity, type: OrderType.Market },
        price,
        tag,
        refs
      );
    } catch (error) {
      if (!(error instanceof OrderRefusedError)) throw error;

      ledger.removeExitLegs(refs);
    }
  }

  /** The exits still watched, the legs of each, with those whose last day has passed ended unsold. */
  function watchedExits(): PaperExitLeg[][] {
    const watched: PaperExitLeg[][] = [];
    const exits = groupBy(ledger.exitLegs(), ({ tag }) => tag);

    for (const legs of Object.values(exits)) {
      const [first] = legs;

      if (!first) continue;

      const today = exchangeDate(first.instrument.market, new Date(now()));

      if (first.until < today) {
        ledger.removeExitLegs(legs.map(({ ref }) => ref));
      } else {
        watched.push(legs);
      }
    }

    return watched;
  }

  /**
   * Sells each exit a minute bar of its listing reached, once the bar opened after the exit was
   * placed and after this run began following the listing at `followedAt`, so a price reached while
   * the app was closed, which a stream's first bars of the session hold, sells nothing.
   */
  function settleBars(
    instrument: SymbolRef,
    bars: readonly Candle[],
    followedAt: number
  ) {
    const ordered = bars.toSorted((left, right) => left.time - right.time);
    let sold = false;

    for (const legs of watchedExits()) {
      const [first] = legs;

      if (!first || symbolKey(first.instrument) !== symbolKey(instrument)) {
        continue;
      }

      // The minute either began in holds prices from before it.
      const from = nextMinute(Math.max(first.placedAt, followedAt));

      for (const bar of ordered) {
        const price = bar.time < from ? null : exitPrice(legs, bar);

        if (price !== null) {
          sellExit(legs, price);
          sold = true;
          break;
        }
      }
    }

    followBars();

    if (sold) options.onExitSold?.();
  }

  const streams = new Map<string, AbortController>();

  /** Follows the bars of each listing an exit is watched on, and stops following the rest. */
  function followBars() {
    const { bars } = options;

    if (!bars) return;

    const wanted = new Map(
      ledger
        .exitLegs()
        .map(({ instrument }) => [symbolKey(instrument), instrument] as const)
    );

    for (const [key, controller] of streams) {
      if (!wanted.has(key)) {
        controller.abort();
        streams.delete(key);
      }
    }

    for (const [key, instrument] of wanted) {
      if (streams.has(key)) continue;

      const controller = new AbortController();
      const followedAt = now();

      streams.set(key, controller);

      // A stream that ends or fails leaves the last price to check until the next ask follows it again.
      void (async () => {
        for await (const batch of bars(instrument, controller.signal)) {
          settleBars(instrument, batch, followedAt);
        }
      })()
        .catch(noop)
        .finally(() => {
          if (streams.get(key) === controller) streams.delete(key);
        });
    }
  }

  /** Sells for each exit the listing's last price has reached, for a listing no stream covers. */
  async function settleExits() {
    for (const legs of watchedExits()) {
      const [first] = legs;

      // A listing followed live is settled by its bars, at no request for its price.
      if (!first || streams.has(symbolKey(first.instrument))) continue;

      // A price that cannot be read leaves the exit watched, as a broker's would be.
      const price = await options
        .getLastPrice?.(first.instrument)
        .catch(() => undefined);

      // A bar may have sold it while the price was read.
      const still = ledger.exitLegs().some(({ tag }) => tag === first.tag);

      const reached =
        price !== undefined &&
        legs.some((leg) =>
          leg.leg === ExitLeg.Stop ? price <= leg.price : price >= leg.price
        );

      if (still && reached) sellExit(legs, price);
    }

    followBars();
  }

  return {
    id: "paper",
    mode: BrokerMode.Paper,
    markets: [Market.TW, Market.US],

    async getAccount() {
      const { cash, positions } = account();

      return { cash, positions };
    },

    async getFills(since) {
      return ledger
        .fills(since)
        .map((filled) => omit(filled, ["tag", "limitPrice"]));
    },

    async getOrders(since) {
      return ledger
        .fills(since)
        .map(
          ({
            orderId,
            tag,
            limitPrice,
            instrument,
            side,
            quantity,
            filledAt,
          }) => ({
            id: orderId,
            tag,
            order:
              limitPrice === null
                ? { instrument, side, quantity, type: OrderType.Market }
                : {
                    instrument,
                    side,
                    quantity,
                    type: OrderType.Limit,
                    limitPrice,
                  },
            filled: quantity,
            status: BrokerOrderStatus.Filled,
            placedAt: filledAt,
          })
        );
    },

    async cancelOrder() {
      throw new Error(
        "The paper account fills every order as it takes it, so none is left to cancel"
      );
    },

    async placeOrder(order, tag) {
      return fill(order, await fillPrice(order), tag);
    },

    exits: {
      async place(instrument, quantity, exit, tag) {
        const legs = exitLegs(exit).map(({ leg, price }) => ({
          ref: `${tag}:${leg}`,
          tag,
          instrument,
          quantity,
          leg,
          price,
          until: exit.until,
          placedAt: now(),
        }));

        ledger.addExitLegs(legs);
        followBars();

        return legs.map(({ ref }) => ref);
      },

      async watching() {
        await settleExits();

        return ledger.exitLegs().map((leg) => omit(leg, ["tag", "until"]));
      },

      async cancel(ref) {
        if (!ledger.exitLegs().some((leg) => leg.ref === ref)) {
          throw new Error(`The paper account watches no exit leg ${ref}`);
        }

        ledger.removeExitLegs([ref]);
        followBars();
      },
    },
  };
}

/** The time, UTC seconds as a bar's, of the minute after the one `at`, UTC milliseconds, falls in. */
const nextMinute = (at: number) =>
  (Math.floor(at / MINUTE_MS) + 1) * (MINUTE_MS / 1000);

/**
 * The price an exit's leg sells at in `bar`, or `null` where the bar reaches neither: at the bar's
 * open where it opened past a leg, and otherwise at the leg's price. A bar that reaches both sells
 * at the stop, since nothing in it tells which came first.
 */
export function exitPrice(
  legs: readonly Pick<WatchedExitLeg, "leg" | "price">[],
  bar: Pick<Candle, "open" | "high" | "low">
): number | null {
  const stop = legs.find(({ leg }) => leg === ExitLeg.Stop)?.price;
  const target = legs.find(({ leg }) => leg === ExitLeg.Target)?.price;

  if (target !== undefined && bar.open >= target) return bar.open;

  if (stop !== undefined && bar.open <= stop) return bar.open;

  if (stop !== undefined && bar.low <= stop) return stop;

  if (target !== undefined && bar.high >= target) return target;

  return null;
}
