import { omit } from "es-toolkit";

import {
  BrokerMode,
  BrokerOrderStatus,
  OrderRefusedError,
} from "@solyx/core/broker";
import type { BrokerAdapter } from "@solyx/core/broker";
import { Market, currencyOf, symbolKey } from "@solyx/core/market";
import type { Currency, SymbolRef } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
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

/**
 * Where the paper account is kept, so it outlives the app as its proposals do. Synchronous, so an
 * order reads and writes the account with no other order in between.
 */
export interface PaperLedger {
  /** `undefined` before the account's first order. */
  read(): PaperAccount | undefined;
  /** Keeps the account as an order left it, and the order's fill, in one write. */
  write(account: PaperAccount, fill: PaperFill): void;
  /** The fills from `since`, UTC milliseconds, on, oldest first. */
  fills(since: number): PaperFill[];
}

export interface PaperBrokerOptions {
  /** What the account opens with. */
  cash: Partial<Record<Currency, number>>;
  ledger: PaperLedger;
  /** Only market orders need it; limit orders fill at their limit price. */
  getLastPrice?: (instrument: SymbolRef) => Promise<number>;
  /** @default Date.now */
  now?: () => number;
}

/**
 * Fills every order immediately and in full. No fees, no securities transaction tax, no shorting —
 * good enough to exercise the order flow, not to judge a strategy. An order it cannot fill is
 * refused, since it changes nothing before the fill is written.
 */
export function createPaperBroker(options: PaperBrokerOptions): BrokerAdapter {
  const account = (): PaperAccount =>
    options.ledger.read() ?? {
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

  return {
    id: "paper",
    mode: BrokerMode.Paper,
    markets: [Market.TW, Market.US],

    async getAccount() {
      const { cash, positions } = account();

      return { cash, positions };
    },

    async getFills(since) {
      return options.ledger
        .fills(since)
        .map((fill) => omit(fill, ["tag", "limitPrice"]));
    },

    async getOrders(since) {
      return options.ledger
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

    async placeOrder(order, tag) {
      const { now = Date.now } = options;
      const price = await fillPrice(order);
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

      options.ledger.write(
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
        }
      );

      return { orderId };
    },
  };
}
