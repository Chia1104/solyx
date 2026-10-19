import { groupBy, omit } from "es-toolkit";

import {
  BrokerMode,
  BrokerOrderStatus,
  OrderRefusedError,
} from "@solyx/core/broker";
import type { BrokerAdapter, WatchedExitLeg } from "@solyx/core/broker";
import {
  Market,
  currencyOf,
  exchangeDate,
  symbolKey,
} from "@solyx/core/market";
import type { Currency, SymbolRef } from "@solyx/core/market";
import { ExitLeg, OrderType, Side, exitLegs } from "@solyx/core/order";
import type { AccountSnapshot, Fill, OrderRequest } from "@solyx/core/order";
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
  /** @default Date.now */
  now?: () => number;
}

/**
 * Fills every order immediately and in full. No fees, no securities transaction tax, no shorting —
 * good enough to exercise the order flow, not to judge a strategy. An order it cannot fill is
 * refused, since it changes nothing before the fill is written. It watches exits only as it is
 * asked what it watches, against the listing's last price then: a leg the price has reached sells
 * whole at that price and ends its siblings in the same write, so one sale ends the exit, and one
 * whose last day has passed ends unsold.
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

  /** Sells for each exit a leg's price has reached, and ends those whose last day has passed. */
  async function settleExits() {
    const exits = groupBy(ledger.exitLegs(), ({ tag }) => tag);

    for (const legs of Object.values(exits)) {
      const [first] = legs;

      if (!first) continue;

      const { instrument, quantity, tag, until } = first;
      const refs = legs.map(({ ref }) => ref);

      if (until < exchangeDate(instrument.market, new Date(now()))) {
        ledger.removeExitLegs(refs);
        continue;
      }

      // A price that cannot be read leaves the exit watched, as a broker's would be.
      const price = await options
        .getLastPrice?.(instrument)
        .catch(() => undefined);

      const reached =
        price !== undefined &&
        legs.some((leg) =>
          leg.leg === ExitLeg.Stop ? price <= leg.price : price >= leg.price
        );

      if (!reached) continue;

      try {
        fill(
          { instrument, side: Side.Sell, quantity, type: OrderType.Market },
          price,
          tag,
          refs
        );
      } catch (error) {
        // Shares sold meanwhile leave none for the exit, which ends unsold.
        if (!(error instanceof OrderRefusedError)) throw error;

        ledger.removeExitLegs(refs);
      }
    }
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
      },
    },
  };
}
